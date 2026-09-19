import { spawn } from "node:child_process";

const MAX_STDERR_BYTES = 64 * 1024;

export type FfmpegProgress = {
  ratio: number;
  renderedSeconds: number;
};

export type FfmpegRunOptions = {
  durationSeconds: number;
  stallTimeoutMs?: number;
  maxDurationMs?: number;
  onProgress?: (progress: FfmpegProgress) => void | Promise<void>;
};

export function renderDeadlineMs(durationSeconds: number): number {
  // Three minutes for a <=30s output; longer clips get the same 6x budget.
  // This bounds work, not a promise that every input will finish successfully.
  return Math.max(180_000, Math.ceil(durationSeconds * 6_000));
}

export class FfmpegRenderError extends Error {
  readonly reason: "exit" | "spawn" | "stall" | "timeout";
  readonly diagnostic: string;

  constructor(reason: "exit" | "spawn" | "stall" | "timeout", diagnostic = "") {
    const message = reason === "timeout"
      ? "Video rendering timed out. Retry processing; if it repeats, the worker needs more processing capacity."
      : reason === "stall"
      ? "Video rendering stopped making progress. Please try this clip again."
      : "FFmpeg could not render this clip. Please try again.";
    super(message);
    this.name = "FfmpegRenderError";
    this.reason = reason;
    this.diagnostic = diagnostic;
  }
}

/**
 * Runs FFmpeg without buffering its output in memory. Progress callbacks are
 * serialized and throttled, and a wedged encoder is terminated independently
 * of the total render time.
 */
export async function runFfmpeg(
  executable: string,
  args: string[],
  options: FfmpegRunOptions,
): Promise<void> {
  const durationUs = Math.max(1, options.durationSeconds * 1_000_000);
  const stallTimeoutMs = options.stallTimeoutMs ?? 120_000;
  const maxDurationMs = options.maxDurationMs ?? renderDeadlineMs(options.durationSeconds);

  await new Promise<void>((resolve, reject) => {
    // -progress is an output option and must precede the output file.
    const child = spawn(
      executable,
      [...args.slice(0, -1), "-progress", "pipe:3", "-nostats", args.at(-1)!],
      {
      stdio: ["ignore", "ignore", "pipe", "pipe"],
      },
    );
    let settled = false;
    let progressBuffer = "";
    let stderr = "";
    let lastProgressAt = Date.now();
    let maxRenderedUs = -1;
    let lastReportedAt = 0;
    let callbackChain = Promise.resolve();
    let terminalError: Error | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(stallTimer);
      clearTimeout(deadlineTimer);
      void callbackChain.then(
        () => error ? reject(error) : resolve(),
        () => reject(new FfmpegRenderError("exit", "Progress callback failed")),
      );
    };

    const report = (renderedUs: number, force = false) => {
      const now = Date.now();
      const ratio = Math.min(1, Math.max(0, renderedUs / durationUs));
      if (renderedUs > maxRenderedUs) {
        maxRenderedUs = renderedUs;
        lastProgressAt = now;
      }
      if (!options.onProgress) return;
      if (terminalError) return;
      if (!force && now - lastReportedAt < 2_000) return;
      lastReportedAt = now;
      callbackChain = callbackChain
        .then(() => options.onProgress?.({
          ratio,
          renderedSeconds: renderedUs / 1_000_000,
        }))
        .catch((error: unknown) => {
          if (terminalError) return;
          const detail = error instanceof Error ? error.message : String(error);
          terminalError = new FfmpegRenderError("exit", `Progress callback failed: ${detail}`);
          child.kill("SIGKILL");
        });
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-MAX_STDERR_BYTES);
    });
    child.stdio[3]?.on("data", (chunk: Buffer) => {
      progressBuffer += chunk.toString("utf8");
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        if (key === "out_time_us" || key === "out_time_ms") {
          const renderedUs = Number(value);
          if (Number.isFinite(renderedUs)) report(renderedUs);
        } else if (key === "progress" && value === "end") {
          report(durationUs, true);
        }
      }
    });

    child.once("error", (error) => {
      finish(new FfmpegRenderError("spawn", error.message));
    });
    child.once("close", (code, signal) => {
      if (terminalError) finish(terminalError);
      else if (code === 0) finish();
      else finish(new FfmpegRenderError(
        "exit",
        `exit=${code ?? "none"} signal=${signal ?? "none"}\n${stderr}`,
      ));
    });

    const stallTimer = setInterval(() => {
      if (Date.now() - lastProgressAt <= stallTimeoutMs) return;
      if (terminalError) return;
      terminalError = new FfmpegRenderError("stall", stderr);
      child.kill("SIGKILL");
    }, Math.min(5_000, Math.max(25, Math.floor(stallTimeoutMs / 4))));
    stallTimer.unref();
    const deadlineTimer = setTimeout(() => {
      if (terminalError || settled) return;
      terminalError = new FfmpegRenderError("timeout", `Exceeded ${maxDurationMs}ms render budget\n${stderr}`);
      child.kill("SIGKILL");
    }, maxDurationMs);
    deadlineTimer.unref();
  });
}
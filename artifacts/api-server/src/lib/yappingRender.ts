import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MontageChoice } from "./montage";

export type MusicChoice = "off" | "upbeat" | "chill";
export type EffectsChoice = "none" | "punchy";
export type EditOptions = {
  music: MusicChoice;
  effects: EffectsChoice;
  musicVolume: number;
};

export const DEFAULT_EDIT_OPTIONS: EditOptions = {
  music: "off",
  effects: "none",
  musicVolume: 0.10,
};

const musicDir = fileURLToPath(new URL("./music", import.meta.url));

export function normalizeEditOptions(value: unknown): EditOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_EDIT_OPTIONS };
  }
  const raw = value as Record<string, unknown>;
  const music = raw.music === "upbeat" || raw.music === "chill" || raw.music === "off"
    ? raw.music
    : DEFAULT_EDIT_OPTIONS.music;
  const effects = raw.effects === "punchy" || raw.effects === "none"
    ? raw.effects
    : DEFAULT_EDIT_OPTIONS.effects;
  const musicVolume = typeof raw.musicVolume === "number" && Number.isFinite(raw.musicVolume)
    ? Math.min(0.25, Math.max(0, raw.musicVolume))
    : DEFAULT_EDIT_OPTIONS.musicVolume;
  return { music, effects, musicVolume };
}

export function musicAsset(choice: MusicChoice): string | null {
  return choice === "off" ? null : path.join(musicDir, `${choice}.wav`);
}

export function montageDuration(choice: MontageChoice): number {
  return choice.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
}

// Fit to 9:16 before any HDR float conversion so 4K sources do not expand into
// gbrpf32le at full resolution (that path OOMs small Replit Autoscale VMs).
const PORTRAIT_FIT =
  "scale=1080:1920:force_original_aspect_ratio=increase:force_divisible_by=2,crop=1080:1920";

export function hdrToneMapFilter(): string {
  return "zscale=tin=auto:t=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0," +
    "zscale=p=bt709:t=bt709:m=bt709:r=limited";
}

export function ffmpegThreadCount(available: number): number {
  if (!Number.isFinite(available) || available < 2) return 1;
  return 2;
}

export function segmentVideoFilter(
  index: number,
  effects: EffectsChoice,
  hdr = false,
): string {
  const toneMap = hdr ? `${hdrToneMapFilter()},` : "";
  if (effects === "none") return `${PORTRAIT_FIT},${toneMap}setsar=1,format=yuv420p`;
  // Alternate a restrained center/offset crop at each source edit. Captions are
  // burned in later, so their geometry and timing remain untouched.
  const zoom = index % 2 ? "1118:1988" : "1102:1960";
  const x = index % 2 ? "(in_w-out_w)*0.70" : "(in_w-out_w)*0.30";
  return `${PORTRAIT_FIT},${toneMap}scale=${zoom},crop=1080:1920:x=${x}:y=(in_h-out_h)/2,` +
    "eq=contrast=1.035:saturation=1.06,setsar=1,format=yuv420p";
}

type ExecLike = {
  message?: unknown;
  stderr?: unknown;
  stdout?: unknown;
  killed?: unknown;
  signal?: unknown;
  code?: unknown;
};

function execText(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const failure = err as ExecLike;
  return [failure.stderr, failure.stdout]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

export function isExecOomOrKill(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const failure = err as ExecLike;
  return failure.killed === true || failure.signal === "SIGKILL" || failure.code === 137;
}

export function shouldRetryRenderWithoutHdr(err: unknown): boolean {
  if (isExecOomOrKill(err)) return true;
  return /zscale|tonemap|no such filter|impossible to convert/i.test(execText(err));
}

export function describeExecFailure(err: unknown): string {
  if (isExecOomOrKill(err)) {
    return "Rendering was stopped by the host before the clip finished. " +
      "This usually means the Replit Autoscale machine ran out of memory or froze the FFmpeg worker. " +
      "Publish as a Reserved VM and try again.";
  }
  const stderr = execText(err).replace(/\s+/g, " ").trim();
  if (/no such filter:\s*'?zscale/i.test(stderr)) {
    return "This FFmpeg build cannot tone-map HDR video (missing zscale). Try a non-HDR source, or retry.";
  }
  if (/invalid too big or non positive size/i.test(stderr)) {
    return "FFmpeg could not scale this video into a 1080×1920 portrait frame. Try a different source file.";
  }
  if (stderr) return `FFmpeg could not render this clip: ${stderr.slice(0, 400)}`;
  if (err instanceof Error && err.message && !err.message.startsWith("Command failed")) {
    return err.message;
  }
  return "FFmpeg could not render this clip. Check server logs for the full command output.";
}

export function musicMixFilter(duration: number, volume: number): string {
  const fadeStart = Math.max(0, duration - 0.35).toFixed(3);
  const end = duration.toFixed(3);
  return [
    "[aout]asplit=2[voice][duckkey]",
    `[1:a]volume=${volume.toFixed(4)}[musicquiet]`,
    "[musicquiet][duckkey]sidechaincompress=threshold=0.020:ratio=8:" +
      "attack=15:release=350:makeup=1[ducked]",
    `[voice][ducked]amix=inputs=2:duration=first:normalize=0,` +
      `alimiter=limit=0.95,atrim=duration=${end},afade=t=out:st=${fadeStart}:d=0.35[afinal]`,
  ].join(";");
}
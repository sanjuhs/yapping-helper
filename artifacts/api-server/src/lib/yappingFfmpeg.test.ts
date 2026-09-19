import assert from "node:assert/strict";
import test from "node:test";
import { FfmpegRenderError, renderDeadlineMs, runFfmpeg } from "./yappingFfmpeg";

test("short renders have a three-minute budget and long renders scale proportionally", () => {
  assert.equal(renderDeadlineMs(15), 180_000);
  assert.equal(renderDeadlineMs(30), 180_000);
  assert.equal(renderDeadlineMs(60), 360_000);
  assert.equal(renderDeadlineMs(90), 540_000);
});

test("reads FFmpeg progress from fd 3 and completes pending callbacks", async () => {
  const ratios: number[] = [];
  await runFfmpeg("/bin/sh", [
    "-c",
    "printf 'out_time_us=500000\\nprogress=continue\\n" +
      "out_time_us=1000000\\nprogress=end\\n' >&3",
    "unused-output",
  ], {
    durationSeconds: 1,
    onProgress: async ({ ratio }) => {
      await Promise.resolve();
      ratios.push(ratio);
    },
  });
  assert.equal(ratios.at(-1), 1);
});

test("bounds diagnostics while exposing only a friendly render error", async () => {
  let failure: unknown;
  try {
    await runFfmpeg("/bin/sh", [
      "-c",
      "head -c 100000 /dev/zero | tr '\\0' x >&2; exit 7",
      "unused-output",
    ], { durationSeconds: 1 });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof FfmpegRenderError);
  assert.equal(failure.message, "FFmpeg could not render this clip. Please try again.");
  assert.ok(failure.diagnostic.length <= 64 * 1024 + 64);
  assert.doesNotMatch(failure.message, /unused-output|repeat|progress/);
});

test("repeated non-advancing progress does not prevent stall detection", async () => {
  const started = Date.now();
  let failure: unknown;
  try {
    await runFfmpeg("/bin/sh", [
      "-c",
      "while :; do printf 'out_time_us=0\\nprogress=continue\\n' >&3; sleep 0.02; done",
      "unused-output",
    ], { durationSeconds: 1, stallTimeoutMs: 100 });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof FfmpegRenderError);
  assert.equal(failure.reason, "stall");
  assert.ok(Date.now() - started < 2_000);
});

test("progress callback rejection is handled immediately and terminates FFmpeg", async () => {
  const started = Date.now();
  let failure: unknown;
  try {
    await runFfmpeg("/bin/sh", [
      "-c",
      "printf 'out_time_us=500000\\nprogress=continue\\n' >&3; while :; do :; done",
      "unused-output",
    ], {
      durationSeconds: 1,
      onProgress: async () => {
        throw new Error("database unavailable");
      },
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof FfmpegRenderError);
  assert.equal(failure.message, "FFmpeg could not render this clip. Please try again.");
  assert.match(failure.diagnostic, /Progress callback failed: database unavailable/);
  assert.ok(Date.now() - started < 2_000);
});

test("advancing progress cannot bypass the overall render deadline", async () => {
  const started = Date.now();
  await assert.rejects(runFfmpeg("/bin/sh", [
    "-c",
    "i=0; while :; do i=$((i+1)); printf 'out_time_us=%s\\nprogress=continue\\n' \"$i\" >&3; sleep 0.02; done",
    "unused-output",
  ], {
    durationSeconds: 30,
    stallTimeoutMs: 1_000,
    maxDurationMs: 150,
  }), (error: unknown) => {
    assert.ok(error instanceof FfmpegRenderError);
    assert.equal(error.reason, "timeout");
    assert.match(error.message, /timed out/);
    assert.doesNotMatch(error.message, /unused-output|out_time_us/);
    return true;
  });
  assert.ok(Date.now() - started < 2_000);
});
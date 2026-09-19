import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  describeExecFailure,
  ffmpegThreadCount,
  hdrToneMapFilter,
  isExecOomOrKill,
  montageDuration,
  musicAsset,
  musicMixFilter,
  normalizeEditOptions,
  segmentVideoFilter,
  shouldRetryRenderWithoutHdr,
} from "./yappingRender";

test("normalizes edit options and safely defaults older jobs", () => {
  assert.deepEqual(normalizeEditOptions(undefined), {
    music: "off", effects: "none", musicVolume: 0.10,
  });
  assert.deepEqual(normalizeEditOptions({
    music: "upbeat", effects: "punchy", musicVolume: 9,
  }), {
    music: "upbeat", effects: "punchy", musicVolume: 0.25,
  });
  assert.deepEqual(normalizeEditOptions({
    music: "unknown", effects: "unknown", musicVolume: -1,
  }), {
    music: "off", effects: "none", musicVolume: 0,
  });
});

test("builds duration-preserving punch and ducked music filters", () => {
  assert.equal(montageDuration({
    title: "", hook: "", reason: "",
    segments: [{ start: 2, end: 4.5 }, { start: 10, end: 11 }],
  }), 3.5);
  assert.match(segmentVideoFilter(0, "punchy"), /eq=contrast=1\.035:saturation=1\.06/);
  assert.notEqual(segmentVideoFilter(0, "punchy"), segmentVideoFilter(1, "punchy"));
  assert.doesNotMatch(segmentVideoFilter(0, "none"), /eq=/);
  assert.match(segmentVideoFilter(0, "none"), /force_divisible_by=2/);
  const mix = musicMixFilter(3.5, 0.1);
  assert.match(mix, /sidechaincompress=/);
  assert.match(mix, /amix=inputs=2:duration=first:normalize=0/);
  assert.match(mix, /atrim=duration=3\.500/);
  assert.match(mix, /afade=t=out:st=3\.150:d=0\.35/);
});

test("downscales to portrait before HDR float conversion", () => {
  const hdr = segmentVideoFilter(0, "none", true);
  const scaleAt = hdr.indexOf("scale=1080:1920");
  const zscaleAt = hdr.indexOf("zscale=");
  assert.ok(scaleAt >= 0 && zscaleAt > scaleAt);
  assert.match(hdr, new RegExp(hdrToneMapFilter().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(segmentVideoFilter(0, "none", false), /zscale=/);
});

test("caps FFmpeg at two threads and explains host kills without dumping the command", () => {
  assert.equal(ffmpegThreadCount(1), 1);
  assert.equal(ffmpegThreadCount(8), 2);
  assert.equal(isExecOomOrKill({ killed: true, signal: "SIGKILL", code: 137 }), true);
  assert.equal(shouldRetryRenderWithoutHdr({ stderr: "No such filter: 'zscale'" }), true);
  assert.equal(shouldRetryRenderWithoutHdr({ stderr: "No such file or directory" }), false);
  const message = describeExecFailure({
    killed: true,
    signal: "SIGKILL",
    message: "Command failed: /home/runner/workspace/node_modules/.pnpm/ffmpeg-static@5.3.0/ffmpeg ...",
  });
  assert.match(message, /Reserved VM/);
  assert.doesNotMatch(message, /Command failed/);
  assert.match(
    describeExecFailure({ stderr: "Invalid too big or non positive size for width '1080'" }),
    /1080/,
  );
});

test("ships deterministic stereo PCM music loops", async () => {
  for (const choice of ["upbeat", "chill"] as const) {
    const asset = musicAsset(choice);
    assert.ok(asset);
    await access(asset);
    const header = (await readFile(asset)).subarray(0, 44);
    assert.equal(header.toString("ascii", 0, 4), "RIFF");
    assert.equal(header.toString("ascii", 8, 12), "WAVE");
    assert.equal(header.readUInt16LE(22), 2);
    assert.equal(header.readUInt32LE(24), 44_100);
    assert.equal(header.readUInt16LE(34), 16);
  }
});
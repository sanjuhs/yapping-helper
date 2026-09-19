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

export function segmentVideoFilter(index: number, effects: EffectsChoice): string {
  const base = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  if (effects === "none") return `${base},setsar=1,format=yuv420p`;
  // Alternate a restrained center/offset crop at each source edit. Captions are
  // burned in later, so their geometry and timing remain untouched.
  const zoom = index % 2 ? "1118:1988" : "1102:1960";
  const x = index % 2 ? "(in_w-out_w)*0.70" : "(in_w-out_w)*0.30";
  return `${base},scale=${zoom},crop=1080:1920:x=${x}:y=(in_h-out_h)/2,` +
    "eq=contrast=1.035:saturation=1.06,setsar=1,format=yuv420p";
}

export function hdrVideoFilter(index: number, effects: EffectsChoice): string {
  // Resize while zscale converts the transfer function to linear light. This
  // avoids tonemapping every source pixel, without resizing nonlinear HDR data
  // or changing the final 1080x1920 crop/caption canvas.
  const resizeAndToneMap =
    "zscale=w='if(gt(iw/ih,0.5625),-2,1080)':" +
    "h='if(gt(iw/ih,0.5625),1920,-2)':t=linear:npl=100," +
    "format=gbrpf32le,tonemap=tonemap=hable:desat=0," +
    "zscale=p=bt709:t=bt709:m=bt709:r=limited,crop=1080:1920";
  if (effects === "none") return `${resizeAndToneMap},setsar=1,format=yuv420p`;
  const zoom = index % 2 ? "1118:1988" : "1102:1960";
  const x = index % 2 ? "(in_w-out_w)*0.70" : "(in_w-out_w)*0.30";
  return `${resizeAndToneMap},scale=${zoom},crop=1080:1920:x=${x}:y=(in_h-out_h)/2,` +
    "eq=contrast=1.035:saturation=1.06,setsar=1,format=yuv420p";
}

export function segmentInputArgs(
  source: string,
  segment: { start: number; end: number },
): string[] {
  const duration = segment.end - segment.start;
  return [
    "-ss", segment.start.toFixed(6),
    "-t", duration.toFixed(6),
    "-i", source,
  ];
}

export function musicMixFilter(duration: number, volume: number, musicInput = 1): string {
  const fadeStart = Math.max(0, duration - 0.35).toFixed(3);
  const end = duration.toFixed(3);
  return [
    "[aout]asplit=2[voice][duckkey]",
    `[${musicInput}:a]volume=${volume.toFixed(4)}[musicquiet]`,
    "[musicquiet][duckkey]sidechaincompress=threshold=0.020:ratio=8:" +
      "attack=15:release=350:makeup=1[ducked]",
    `[voice][ducked]amix=inputs=2:duration=first:normalize=0,` +
      `alimiter=limit=0.95,atrim=duration=${end},afade=t=out:st=${fadeStart}:d=0.35[afinal]`,
  ].join(";");
}
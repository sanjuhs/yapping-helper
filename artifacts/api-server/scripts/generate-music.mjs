import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 44_100;
const seconds = 8;
const frames = sampleRate * seconds;
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/music");

function note(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function envelope(t, length, attack = 0.02, release = 0.2) {
  return Math.min(1, t / attack, Math.max(0, (length - t) / release));
}

function render(kind) {
  const data = Buffer.alloc(frames * 4);
  let seed = kind === "upbeat" ? 0x51a7 : 0xc411;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  const bpm = kind === "upbeat" ? 120 : 60;
  const beat = 60 / bpm;
  const chords = kind === "upbeat"
    ? [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]
    : [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 67]];
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const bar = Math.floor(t / 2) % 4;
    const chord = chords[bar];
    let left = 0;
    let right = 0;
    for (let n = 0; n < chord.length; n++) {
      const f = note(chord[n]);
      const pad = Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(4 * Math.PI * f * t);
      const swell = kind === "chill" ? 0.55 + 0.45 * Math.sin(Math.PI * (t % 2) / 2) : 1;
      left += pad * (n % 2 ? 0.026 : 0.038) * swell;
      right += pad * (n % 2 ? 0.038 : 0.026) * swell;
    }
    if (kind === "upbeat") {
      const step = t % beat;
      const kick = Math.sin(2 * Math.PI * (72 - step * 70) * step) *
        Math.exp(-step * 18) * (Math.floor(t / beat) % 2 === 0 ? 0.20 : 0.10);
      const hatStep = t % (beat / 2);
      const hat = noise() * Math.exp(-hatStep * 70) * 0.035;
      const bassMidi = [48, 45, 41, 43][bar];
      const bass = Math.sin(2 * Math.PI * note(bassMidi) * t) *
        envelope(t % beat, beat, 0.01, 0.12) * 0.12;
      left += kick + hat + bass;
      right += kick + hat * 0.75 + bass;
    } else {
      const pulse = t % 1;
      const bass = Math.sin(2 * Math.PI * note(chord[0] - 12) * t) *
        envelope(pulse, 1, 0.08, 0.35) * 0.055;
      left += bass;
      right += bass;
    }
    // Short edge fades make the deterministic 8-second loop click-free.
    const edge = Math.min(1, t / 0.03, (seconds - t) / 0.03);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left * edge)) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right * edge)) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28); header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

await mkdir(outDir, { recursive: true });
await Promise.all(["upbeat", "chill"].map((kind) =>
  writeFile(path.join(outDir, `${kind}.wav`), render(kind))
));
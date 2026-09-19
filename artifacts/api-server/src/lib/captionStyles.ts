import type { Caption } from "./montage";

type CaptionStyle = {
  fontName: string;
  fontSize: number;
  primary: string;
  secondary: string;
  outline: string;
  background: string;
  bold: boolean;
  italic: boolean;
  borderStyle: 1 | 3;
  outlineWidth: number;
  shadow: number;
  marginV: number;
  animation: string;
};

const STYLES: Record<string, CaptionStyle> = {
  auto: {
    fontName: "DejaVu Sans", fontSize: 70, primary: "&H00FFFFFF", secondary: "&H00FFFFFF",
    outline: "&H00101010", background: "&H70000000", bold: true, italic: false,
    borderStyle: 1, outlineWidth: 4, shadow: 2, marginV: 250, animation: "\\fad(90,90)",
  },
  educational: {
    fontName: "DejaVu Serif", fontSize: 62, primary: "&H00FFFFFF", secondary: "&H00FFFFFF",
    outline: "&H00202020", background: "&H780F172A", bold: false, italic: false,
    borderStyle: 3, outlineWidth: 3, shadow: 0, marginV: 230, animation: "\\fad(150,120)",
  },
  punchy: {
    fontName: "DejaVu Sans", fontSize: 78, primary: "&H0000E8FF", secondary: "&H0000E8FF",
    outline: "&H00000000", background: "&H60000000", bold: true, italic: false,
    borderStyle: 1, outlineWidth: 6, shadow: 3, marginV: 270,
    animation: "\\fscx92\\fscy92\\t(0,120,\\fscx100\\fscy100)\\fad(50,70)",
  },
  storytelling: {
    fontName: "DejaVu Serif", fontSize: 66, primary: "&H00FFFFFF", secondary: "&H00FFFFFF",
    outline: "&H00201008", background: "&H68000000", bold: false, italic: true,
    borderStyle: 1, outlineWidth: 3, shadow: 2, marginV: 220, animation: "\\fad(220,180)",
  },
  interesting: {
    fontName: "DejaVu Sans", fontSize: 68, primary: "&H00FFD9A3", secondary: "&H00FFD9A3",
    outline: "&H00402010", background: "&H70000000", bold: false, italic: false,
    borderStyle: 3, outlineWidth: 3, shadow: 2, marginV: 260,
    animation: "\\fscx96\\fscy96\\t(0,140,\\fscx100\\fscy100)\\fad(80,100)",
  },
  opinionated: {
    fontName: "DejaVu Sans", fontSize: 74, primary: "&H00FFFFFF", secondary: "&H00FFFFFF",
    outline: "&H00181860", background: "&H703020A0", bold: true, italic: false,
    borderStyle: 3, outlineWidth: 4, shadow: 1, marginV: 260,
    animation: "\\fscx94\\fscy94\\t(0,100,\\fscx100\\fscy100)\\fad(60,90)",
  },
};

export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r\n|\r|\n/g, "\\N");
}

export function toAss(captions: Caption[], requestedStyle: string): string {
  const style = STYLES[requestedStyle.toLowerCase()] ?? STYLES.auto;
  const bool = (value: boolean) => value ? -1 : 0;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${style.fontName},${style.fontSize},${style.primary},${style.secondary},${style.outline},${style.background},${bool(style.bold)},${bool(style.italic)},0,0,100,100,0,0,${style.borderStyle},${style.outlineWidth},${style.shadow},2,70,70,${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = captions.map((caption) => {
    const end = Math.max(caption.start + 0.01, caption.end);
    return `Dialogue: 0,${assTime(caption.start)},${assTime(end)},Caption,,0,0,0,,` +
      `{${style.animation}}${escapeAssText(caption.text)}`;
  });
  return `${header}${events.join("\n")}\n`;
}

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.` +
    String(fraction).padStart(2, "0");
}
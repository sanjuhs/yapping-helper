import assert from "node:assert/strict";
import test from "node:test";
import { escapeAssText, toAss } from "./captionStyles";

test("creates a portrait ASS document with timed animated captions", () => {
  const ass = toAss([{ start: 1.234, end: 2.5, text: "A caption" }], "punchy");
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, /Style: Caption,DejaVu Sans,78/);
  assert.match(ass, /Dialogue: 0,0:00:01\.23,0:00:02\.50,Caption/);
  assert.match(ass, /\\t\(0,120,/);
});

test("escapes ASS override syntax, backslashes, and line breaks", () => {
  assert.equal(
    escapeAssText(String.raw`open {tag}\path` + "\nnext"),
    String.raw`open \{tag\}\\path\Nnext`,
  );
  const ass = toAss([{ start: 0, end: 0, text: "{\\b1}\nhello" }], "auto");
  assert.match(ass, /0:00:00\.00,0:00:00\.01/);
  assert.ok(ass.includes(String.raw`\{\\b1\}\Nhello`));
});

test("all requested styles resolve to visibly distinct ASS styles", () => {
  const names = ["auto", "educational", "punchy", "storytelling", "interesting", "opinionated"];
  const styleLines = names.map((name) =>
    toAss([{ start: 0, end: 1, text: "Text" }], name)
      .split("\n").find((line) => line.startsWith("Style: Caption,")),
  );
  assert.equal(new Set(styleLines).size, names.length);
  assert.match(toAss([], "unknown"), /Style: Caption,DejaVu Sans,70/);
});
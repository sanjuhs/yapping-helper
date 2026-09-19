import assert from "node:assert/strict";
import test from "node:test";
import { buildMontageCandidates, compatibleCandidates, findDistinctPlan } from "./montagePlanner";
import {
  assertSourceCapacity,
  captionsForMontage,
  validateChoices,
  type SourceRange,
} from "./montage";

function clip(start: number, end: number) {
  return {
    title: "A title",
    hook: "A hook",
    reason: "A reason",
    segments: [{ start, end }],
  };
}

test("keeps zero-duration Whisper words in timed caption groups", () => {
  const captions = captionsForMontage([
    { start: 1, end: 1.3, word: "going" },
    { start: 1.3, end: 1.3, word: "to" },
    { start: 1.3, end: 2, word: "upload" },
  ], [{ start: 1, end: 3 }]);
  assert.equal(captions[0].text, "going to upload");
  assert.equal(captions[0].start, 0);
  assert.equal(captions[0].end, 1);
});

test("candidate planner supports two distinct legal edits from a 68-second source", () => {
  const segments = Array.from({ length: 34 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.9, text: `Sentence ${i}.` }));
  const words = segments.map((s) => ({ start: s.start, end: s.end, word: s.text }));
  const candidates = buildMontageCandidates(segments, words, "short");
  assert.ok(candidates.length > 2 && candidates.length <= 80);
  const plan = findDistinctPlan(candidates, 2);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  for (const candidate of candidates) {
    assert.ok(candidate.duration >= 12 && candidate.duration <= 33);
    assert.ok(candidate.segments.length >= 2);
  }
  const first = compatibleCandidates(candidates, [], 2)[0];
  assert.ok(first);
  assert.ok(compatibleCandidates(candidates, [first], 2).length);
  const choices = plan.map(c => ({ ...c, title: "title", hook: "hook", reason: "reason" }));
  assert.equal(validateChoices(choices, 68, 2, "short", true).length, 2);
});

test("accepts the exact short, medium, and long duration limits", () => {
  for (const [length, min, max] of [
    ["short", 12, 33],
    ["medium", 27, 63],
    ["long", 57, 93],
  ] as const) {
    assert.equal(validateChoices([clip(0, min)], 120, 1, length)[0].segments[0].end, min);
    assert.equal(validateChoices([clip(0, max)], 120, 1, length)[0].segments[0].end, max);
  }
});

test("rejects duplicate montages and overlapping source reuse", () => {
  assert.throws(
    () => validateChoices([clip(0, 15), clip(0, 15)], 60, 2, "short"),
    /duplicate montage sequences/,
  );
  assert.throws(
    () => validateChoices([clip(0, 15), clip(9, 25)], 60, 2, "short"),
    /distinct clips/,
  );
});

test("rejects source overflow and insufficient source capacity", () => {
  assert.throws(
    () => validateChoices([clip(0, 15.06)], 15, 1, "short"),
    /out-of-range timestamp/,
  );
  assert.throws(() => assertSourceCapacity(23.94, 2, "short"), /source is too short/);
  assert.doesNotThrow(() => assertSourceCapacity(24, 2, "short"));
});

test("splices caption timestamps at edit offsets and clamps to montage duration", () => {
  const ranges: SourceRange[] = [
    { start: 10, end: 12 },
    { start: 20, end: 21 },
  ];
  const captions = captionsForMontage(
    [
      { start: 9.4, end: 9.9, word: "outside" },
      { start: 10.2, end: 10.6, word: "First" },
      { start: 10.7, end: 11, word: "part." },
      { start: 20.1, end: 20.4, word: "Second" },
      { start: 20.5, end: 21.2, word: "part." },
      { start: 99, end: 100, word: "overflow" },
    ],
    ranges,
  );

  assert.equal(captions.length, 2);
  assert.deepEqual(captions.map(({ text, end }) => ({ text, end })), [
    { end: 1, text: "First part." },
    { end: 3, text: "Second part." },
  ]);
  assert.ok(Math.abs(captions[0].start - 0.2) < 0.000001);
  assert.ok(Math.abs(captions[1].start - 2.1) < 0.000001);
});

test("plans two exact, distinct short montages from a real-sized 68 second transcript", () => {
  const segments = Array.from({ length: 17 }, (_, index) => ({
    start: index * 4,
    end: index * 4 + 3.8,
    text: `Complete thought number ${index + 1}.`,
  }));
  const words = segments.flatMap((segment, index) => [
    { start: segment.start, end: segment.start + 0.8, word: "Complete" },
    { start: segment.start + 0.8, end: segment.start + 1.6, word: "thought" },
    { start: segment.start + 1.6, end: segment.end, word: `${index + 1}.` },
  ]);
  const candidates = buildMontageCandidates(segments, words, "short", 80);
  const plan = findDistinctPlan(candidates, 2);
  assert.ok(plan, "expected a feasible two-clip plan");
  for (const candidate of plan) {
    assert.equal(candidate.segments.length, 2);
    assert.ok(candidate.duration >= 12 && candidate.duration <= 33);
  }
  for (const left of plan[0].segments) for (const right of plan[1].segments) {
    assert.ok(
      Math.min(left.end, right.end) - Math.max(left.start, right.start) <= 0.05,
      "planned clips must not repeat source material",
    );
  }
});

test("bounded planner retains enough distinct choices for ten long clips", () => {
  const segments = Array.from({ length: 120 }, (_, index) => ({
    start: index * 10,
    end: index * 10 + 9,
    text: `Complete long-form thought ${index + 1}.`,
  }));
  const words = segments.flatMap((segment, index) => [
    { start: segment.start, end: segment.start + 2, word: "Complete" },
    { start: segment.start + 2, end: segment.start + 4, word: "thought" },
    { start: segment.start + 4, end: segment.end, word: `${index + 1}.` },
  ]);
  const candidates = buildMontageCandidates(segments, words, "long", 80);
  assert.ok(candidates.length <= 80);
  const plan = findDistinctPlan(candidates, 10);
  assert.ok(plan, "expected ten legal non-repeating long montages");
  assert.ok(plan.every((candidate) => candidate.duration >= 57 && candidate.duration <= 93));
});
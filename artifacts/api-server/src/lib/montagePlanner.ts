import type { SourceRange, TranscriptSegment, TranscriptWord } from "./montage";

export type MontageCandidate = {
  id: string;
  duration: number;
  segments: SourceRange[];
  transcript: string;
};

const LIMITS = {
  short: { min: 12, max: 33 },
  medium: { min: 27, max: 63 },
  long: { min: 57, max: 93 },
} as const;

type Unit = SourceRange & { text: string };
type Span = Unit;

export function buildMontageCandidates(
  segments: TranscriptSegment[],
  words: TranscriptWord[],
  clipLength: string,
  maxCandidates = 80,
): MontageCandidate[] {
  const limits = LIMITS[clipLength as keyof typeof LIMITS];
  if (!limits) throw new Error("The requested clip length is invalid.");
  const units = buildUnits(segments, words);
  if (units.length < 2) return [];
  const seeds = buildDisjointSeeds(units, limits.min, limits.max);

  const spans: Span[] = [];
  const maxSpan = limits.max - 3;
  for (let i = 0; i < units.length; i++) {
    let text = "";
    for (let j = i; j < units.length; j++) {
      const duration = units[j].end - units[i].start;
      if (duration > maxSpan) break;
      text = `${text} ${units[j].text}`.trim();
      if (duration >= 3) spans.push({ start: units[i].start, end: units[j].end, text });
    }
  }

  // Bound pair construction for dense, long transcripts while retaining
  // candidates throughout the source. Disjoint seeds are retained separately.
  if (spans.length > 400) {
    const sampled = Array.from({ length: 400 }, (_, index) => spans[Math.floor(index * spans.length / 400)]);
    spans.splice(0, spans.length, ...sampled);
  }
  const raw: MontageCandidate[] = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i];
      const b = spans[j];
      if (rangesOverlap(a, b)) continue;
      const total = a.end - a.start + b.end - b.start;
      if (total < limits.min || total > limits.max) continue;
      addCandidate(raw, [a, b], total);
      // The same material can tell a different story when the later payoff is
      // the opening hook. Keep both orders for the editor to judge.
      addCandidate(raw, [b, a], total);
      // Keep construction memory bounded even for a dense 20-minute
      // transcript. Repeated representative sampling retains choices across
      // every source region seen so far.
      if (raw.length > maxCandidates * 10) {
        raw.splice(0, raw.length, ...sampleRepresentative(raw, maxCandidates * 5));
      }
    }
  }

  const remaining = Math.max(0, maxCandidates - seeds.length);
  const representative = raw.length <= remaining
    ? raw
    : sampleRepresentative(raw, remaining);
  return withIds([...seeds.slice(0, maxCandidates), ...representative]);
}

function sampleRepresentative(
  candidates: MontageCandidate[],
  count: number,
): MontageCandidate[] {
  // Keep representative choices across the whole source rather than only the
  // earliest pair combinations.
  const sorted = [...candidates];
  sorted.sort((a, b) => {
    const aStart = Math.min(...a.segments.map((range) => range.start));
    const bStart = Math.min(...b.segments.map((range) => range.start));
    return aStart - bStart || a.duration - b.duration;
  });
  const sampled: MontageCandidate[] = [];
  for (let i = 0; i < count; i++) {
    sampled.push(sorted[Math.floor(i * sorted.length / count)]);
  }
  return sampled;
}

export function findDistinctPlan(
  candidates: MontageCandidate[],
  count: number,
  selected: MontageCandidate[] = [],
): MontageCandidate[] | null {
  return findCompletion(candidates, selected, count);
}

export function compatibleCandidates(
  candidates: MontageCandidate[],
  selected: MontageCandidate[],
  totalCount: number,
): MontageCandidate[] {
  return candidates.filter((candidate) => {
    if (selected.some((prior) => candidatesOverlap(prior, candidate))) return false;
    return findCompletion(candidates, [...selected, candidate], totalCount) !== null;
  });
}

function findCompletion(
  candidates: MontageCandidate[],
  selected: MontageCandidate[],
  totalCount: number,
  startIndex = 0,
  budget = { remaining: 10000 },
): MontageCandidate[] | null {
  if (selected.length === totalCount) return selected;
  if (--budget.remaining <= 0 || candidates.length - startIndex < totalCount - selected.length) return null;
  for (let i = startIndex; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (
      selected.some((prior) => prior.id === candidate.id || candidatesOverlap(prior, candidate))
    ) continue;
    const result = findCompletion(candidates, [...selected, candidate], totalCount, i + 1, budget);
    if (result) return result;
  }
  return null;
}

function buildUnits(segments: TranscriptSegment[], words: TranscriptWord[]): Unit[] {
  const units: Unit[] = [];
  for (const segment of segments) {
    const contained = words.filter((word) => {
      const midpoint = (word.start + word.end) / 2;
      return midpoint >= segment.start && midpoint <= segment.end && word.word.trim();
    });
    if (!contained.length) continue;
    if (contained[contained.length - 1].end - contained[0].start <= 15) {
      pushWordUnit(units, contained);
      continue;
    }
    let chunk: TranscriptWord[] = [];
    for (const word of contained) {
      chunk.push(word);
      const elapsed = word.end - chunk[0].start;
      if ((elapsed >= 6 && /[.!?]$/.test(word.word.trim())) || elapsed >= 12) {
        pushWordUnit(units, chunk);
        chunk = [];
      }
    }
    if (chunk.length) pushWordUnit(units, chunk);
  }
  return units;
}

function pushWordUnit(output: Unit[], words: TranscriptWord[]): void {
  const start = words[0].start;
  const end = words[words.length - 1].end;
  if (end - start < 0.2) return;
  output.push({
    start,
    end,
    text: words.map((word) => word.word.trim()).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
  });
}

function buildDisjointSeeds(units: Unit[], min: number, max: number): MontageCandidate[] {
  const seeds: MontageCandidate[] = [];
  let cursor = 0;
  while (cursor < units.length - 1) {
    let end = cursor;
    let duration = 0;
    while (end < units.length && duration < min) {
      duration += units[end].end - units[end].start;
      end++;
    }
    if (duration < min || duration > max || end - cursor < 2) break;
    const split = cursor + Math.floor((end - cursor) / 2);
    const first = mergeUnits(units.slice(cursor, split));
    const second = mergeUnits(units.slice(split, end));
    const exactDuration = first.end - first.start + second.end - second.start;
    if (exactDuration >= min && exactDuration <= max) {
      seeds.push({
        id: "",
        duration: exactDuration,
        segments: [
          { start: first.start, end: first.end },
          { start: second.start, end: second.end },
        ],
        transcript: `Part 1: ${first.text}\nPart 2: ${second.text}`,
      });
    }
    cursor = end;
  }
  return seeds;
}

function mergeUnits(units: Unit[]): Unit {
  return {
    start: units[0].start,
    end: units[units.length - 1].end,
    text: units.map((unit) => unit.text).join(" "),
  };
}

function addCandidate(
  output: MontageCandidate[],
  spans: Span[],
  duration: number,
): void {
  output.push({
    id: "",
    duration,
    segments: spans.map(({ start, end }) => ({ start, end })),
    transcript: spans.map((span, index) => `Part ${index + 1}: ${span.text}`).join("\n"),
  });
}

function withIds(candidates: MontageCandidate[]): MontageCandidate[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    id: `candidate_${String(index + 1).padStart(3, "0")}`,
  }));
}

function rangesOverlap(a: SourceRange, b: SourceRange): boolean {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.05;
}

function candidatesOverlap(a: MontageCandidate, b: MontageCandidate): boolean {
  return a.segments.some((left) => b.segments.some((right) => rangesOverlap(left, right)));
}
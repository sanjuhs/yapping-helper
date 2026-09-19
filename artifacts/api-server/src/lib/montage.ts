export type TranscriptSegment = { start: number; end: number; text: string };
export type TranscriptWord = { start: number; end: number; word: string };
export type SourceRange = { start: number; end: number };
export type MontageChoice = {
  title: string;
  hook: string;
  reason: string;
  segments: SourceRange[];
};

export type Caption = { start: number; end: number; text: string };

const LENGTH_LIMITS = {
  short: { min: 12, max: 33 },
  medium: { min: 27, max: 63 },
  long: { min: 57, max: 93 },
} as const;

export function assertSourceCapacity(
  duration: number,
  requestedClips: number,
  clipLength: string,
): void {
  const limits = LENGTH_LIMITS[clipLength as keyof typeof LENGTH_LIMITS];
  if (!limits) throw new Error("The requested clip length is invalid.");
  const required = limits.min * requestedClips;
  if (duration + 0.05 < required) {
    throw new Error(
      `The source is too short for ${requestedClips} distinct ${clipLength} ` +
      `clip${requestedClips === 1 ? "" : "s"} (at least ${required} seconds of source is required).`,
    );
  }
}

export function validateChoices(
  value: unknown,
  duration: number,
  requestedClips: number,
  clipLength: string,
  requireMultipleSegments = false,
  wordBoundaries?: { starts: number[]; ends: number[] },
): MontageChoice[] {
  if (!Number.isInteger(requestedClips) || requestedClips < 1 || requestedClips > 10) {
    throw new Error("The requested clip count must be between 1 and 10.");
  }
  const limits = LENGTH_LIMITS[clipLength as keyof typeof LENGTH_LIMITS];
  if (!limits) throw new Error("The requested clip length is invalid.");
  if (!Array.isArray(value) || value.length !== requestedClips) {
    throw new Error(`AI selection did not return exactly ${requestedClips} clips.`);
  }

  const choices = value.map((raw, clipIndex) => {
    if (!raw || typeof raw !== "object") throw new Error("AI returned an invalid clip.");
    const candidate = raw as Record<string, unknown>;
    for (const field of ["title", "hook", "reason"] as const) {
      if (typeof candidate[field] !== "string" || !candidate[field].trim()) {
        throw new Error(`AI clip ${clipIndex + 1} is missing ${field}.`);
      }
    }
    if (!Array.isArray(candidate.segments) || candidate.segments.length === 0) {
      throw new Error(`AI clip ${clipIndex + 1} has no source segments.`);
    }
    if (requireMultipleSegments && candidate.segments.length < 2) {
      throw new Error(`AI clip ${clipIndex + 1} did not combine multiple strong source moments.`);
    }
    const segments = candidate.segments.map((rawSegment) => {
      if (!rawSegment || typeof rawSegment !== "object") {
        throw new Error(`AI clip ${clipIndex + 1} has an invalid source segment.`);
      }
      const { start, end } = rawSegment as Record<string, unknown>;
      if (
        typeof start !== "number" || typeof end !== "number" ||
        !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || end > duration + 0.05 || end - start < 0.35
      ) {
        throw new Error(`AI clip ${clipIndex + 1} contains an out-of-range timestamp.`);
      }
      let normalizedStart = start;
      let normalizedEnd = end;
      if (wordBoundaries) {
        const matchedStart = findBoundary(start, wordBoundaries.starts);
        const matchedEnd = findBoundary(end, wordBoundaries.ends);
        if (matchedStart === undefined || matchedEnd === undefined) {
          throw new Error(
            `AI clip ${clipIndex + 1} must start and end on the supplied word boundaries.`,
          );
        }
        // The prompt presents hundredths for token efficiency. Snap a valid
        // hundredth-rounded response back to Whisper's exact timestamps.
        normalizedStart = matchedStart;
        normalizedEnd = matchedEnd;
        if (normalizedEnd - normalizedStart < 0.35) {
          throw new Error(`AI clip ${clipIndex + 1} contains a source segment that is too short.`);
        }
      }
      return {
        start: Math.max(0, normalizedStart),
        end: Math.min(duration, normalizedEnd),
      };
    });
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const overlap = Math.min(segments[i].end, segments[j].end) -
          Math.max(segments[i].start, segments[j].start);
        if (overlap > 0.05) {
          throw new Error(`AI clip ${clipIndex + 1} reuses overlapping source material.`);
        }
      }
    }
    const montageDuration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
    if (montageDuration < limits.min || montageDuration > limits.max) {
      throw new Error(
        `AI clip ${clipIndex + 1} total duration SUM(end-start) is ${montageDuration.toFixed(1)}s; ` +
        `${clipLength} requires ${limits.min}-${limits.max}s. Select longer complete sentences, not isolated words.`,
      );
    }
    return {
      title: (candidate.title as string).trim().slice(0, 100),
      hook: (candidate.hook as string).trim().slice(0, 240),
      reason: (candidate.reason as string).trim().slice(0, 500),
      segments,
    };
  });

  const signatures = new Set<string>();
  for (const choice of choices) {
    const signature = choice.segments
      .map((segment) => `${segment.start.toFixed(1)}-${segment.end.toFixed(1)}`).join("|");
    if (signatures.has(signature)) throw new Error("AI returned duplicate montage sequences.");
    signatures.add(signature);
  }
  for (let i = 0; i < choices.length; i++) {
    for (let j = i + 1; j < choices.length; j++) {
      const aDuration = totalDuration(choices[i].segments);
      const bDuration = totalDuration(choices[j].segments);
      let overlap = 0;
      for (const a of choices[i].segments) for (const b of choices[j].segments) {
        overlap += Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
      }
      if (overlap > Math.min(aDuration, bDuration) * 0.35) {
        throw new Error("The source is too short for distinct clips of the requested length.");
      }
    }
  }
  const selectedTotal = choices.reduce((sum, choice) => sum + totalDuration(choice.segments), 0);
  if (selectedTotal > Math.min(duration * 1.5, requestedClips * limits.max)) {
    throw new Error("AI selected too much repeated source material.");
  }
  return choices;
}

export function captionsForMontage(
  words: TranscriptWord[],
  ranges: SourceRange[],
): Caption[] {
  const captions: Caption[] = [];
  let group: TranscriptWord[] = [];
  let offset = 0;
  let currentSpliceEnd = 0;
  const flush = () => {
    if (!group.length) return;
    captions.push({
      start: group[0].start,
      end: Math.min(currentSpliceEnd, group[group.length - 1].end),
      text: group.map((word) => word.word).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
    });
    group = [];
  };

  for (const range of ranges) {
    const spliceEnd = offset + range.end - range.start;
    currentSpliceEnd = spliceEnd;
    for (const sourceWord of words) {
      const midpoint = (sourceWord.start + sourceWord.end) / 2;
      if (midpoint < range.start || midpoint > range.end || !sourceWord.word.trim()) continue;
      const word = {
        start: Math.max(offset, offset + sourceWord.start - range.start),
        end: Math.min(spliceEnd, offset + sourceWord.end - range.start),
        word: sourceWord.word.trim(),
      };
      // Whisper sometimes gives short words identical start/end timestamps.
      // Keep their text in the surrounding timed caption instead of dropping it.
      if (word.end < word.start || word.start >= spliceEnd) continue;
      const previous = group[group.length - 1];
      if (
        group.length >= 5 ||
        (group.length && (word.start - group[0].start > 2.4 || word.start - previous.end > 0.65))
      ) flush();
      group.push(word);
      if (/[.!?]$/.test(word.word)) flush();
    }
    // Never display one caption across an edit, even when source word timestamps
    // happen to be adjacent.
    flush();
    offset = spliceEnd;
  }
  const montageDuration = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  for (const caption of captions) {
    caption.start = Math.min(montageDuration, Math.max(0, caption.start));
    caption.end = Math.min(montageDuration, Math.max(caption.start, caption.end));
  }
  return captions;
}

export function toSrt(captions: Caption[]): string {
  return captions.map((caption, index) =>
    `${index + 1}\n${srtTime(caption.start)} --> ${srtTime(caption.end)}\n${caption.text}\n`,
  ).join("\n");
}

function totalDuration(ranges: SourceRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start, 0);
}

function findBoundary(value: number, boundaries: number[]): number | undefined {
  let closest: number | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries) {
    const candidateDistance = Math.abs(boundary - value);
    if (candidateDistance <= 0.011 && candidateDistance < distance) {
      closest = boundary;
      distance = candidateDistance;
    }
  }
  return closest;
}

function srtTime(seconds: number): string {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    `${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
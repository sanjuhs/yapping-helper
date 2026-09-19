import type { Job } from '@workspace/api-client-react';

const HEADERS = [
  'filename',
  'source filename',
  'title',
  'hook',
  'rationale',
  'duration',
  'style',
  'music',
  'effects',
  'date',
  'source ranges',
  'MP4 URL',
  'SRT URL',
  'ASS URL',
  'results URL',
] as const;

function safeCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function absoluteUrl(value: string | undefined, origin: string): string {
  return value ? new URL(value, origin).href : '';
}

export function createJobCsv(job: Job, origin: string, resultsUrl: string): string {
  const options = {
    music: job.editOptions?.music ?? 'off',
    effects: job.editOptions?.effects ?? 'none',
  };
  const rows = job.clips.map((clip) => [
    `yapping-clip-${clip.index + 1}.mp4`,
    job.filename,
    clip.title,
    clip.hook,
    clip.reason,
    clip.duration,
    job.style ?? '',
    options.music,
    options.effects,
    job.createdAt,
    (clip.sourceSegments ?? [])
      .map(({ start, end }) => `${start.toFixed(1)}-${end.toFixed(1)}`)
      .join('; '),
    absoluteUrl(clip.downloadUrl, origin),
    absoluteUrl(clip.subtitleUrl, origin),
    absoluteUrl(clip.styledSubtitleUrl, origin),
    absoluteUrl(resultsUrl, origin),
  ]);

  return `\uFEFF${[HEADERS, ...rows].map((row) => row.map(safeCell).join(',')).join('\r\n')}\r\n`;
}

export function downloadJobCsv(job: Job, location: Pick<Location, 'origin' | 'href'>): void {
  const csv = createJobCsv(job, location.origin, location.href);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `yapping-clips-${job.id}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
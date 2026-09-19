import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job } from '@workspace/api-client-react';
import { createJobCsv } from './job-csv.ts';

const job: Job = {
  id: 'job-1',
  filename: 'source.mov',
  status: 'COMPLETE',
  progress: 100,
  currentStep: 'Complete',
  requestedClips: 1,
  style: 'punchy',
  editOptions: { music: 'chill', effects: 'punchy', musicVolume: 0.1 },
  createdAt: '2026-01-02T03:04:05.000Z',
  clips: [{
    id: 'clip-1',
    index: 0,
    title: '=HYPERLINK("bad")',
    hook: 'Unicode, “hello” 👋',
    reason: 'Line one\nLine two',
    duration: 21.5,
    sourceSegments: [{ start: 1, end: 4.25 }],
    downloadUrl: '/api/mp4',
    previewUrl: '/api/preview',
    subtitleUrl: '/api/srt',
    styledSubtitleUrl: '/api/ass',
  }],
};

test('exports BOM-prefixed, escaped CSV with absolute links', () => {
  const csv = createJobCsv(job, 'https://example.test', '/?job=job-1');
  assert.ok(csv.startsWith('\uFEFFfilename,source filename,title,hook'));
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"Unicode, “hello” 👋"/);
  assert.match(csv, /"Line one\nLine two"/);
  assert.match(csv, /https:\/\/example\.test\/api\/mp4/);
  assert.match(csv, /https:\/\/example\.test\/api\/srt/);
  assert.match(csv, /https:\/\/example\.test\/api\/ass/);
  assert.match(csv, /https:\/\/example\.test\/\?job=job-1/);
});

test('neutralizes every spreadsheet formula prefix, including control characters', () => {
  for (const prefix of ['=', '+', '-', '@', '\t', '\r', '\n']) {
    const dangerous = structuredClone(job);
    dangerous.clips[0].title = `${prefix}formula`;
    const csv = createJobCsv(dangerous, 'https://example.test', '/');
    assert.ok(csv.includes(`'${prefix}formula`) || csv.includes(`"'${prefix}formula"`));
  }
});
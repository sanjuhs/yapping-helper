# Changes

## Replit Autoscale / FFmpeg render failures

- Pointed `.replit` at a Reserved VM (`gce`) instead of Autoscale. In-process FFmpeg cannot survive Cloud Run CPU freeze, scale-to-zero, or 512 MB–1 GB machines.
- Scale and crop to 1080×1920 *before* HDR float tone-mapping so 4K sources do not expand into `gbrpf32le` at full resolution.
- Use a single FFmpeg filter thread, retry without tone-mapping after an OOM or missing `zscale`, and re-queue interrupted jobs on API startup.
- Stop showing the raw FFmpeg command as the user-facing error. Failed jobs now get a short explanation and a retry button.

## Hackathon documentation

- Expanded the README with the resolved technology stack, exact AI models and API calls, and a pipeline diagram.
- Distinguished the current AI-guided workflow from autonomous tool-calling or multi-agent systems.
- Documented setup, verification, current security/reliability limitations, and proposed integrations.
- Added a demo-video section awaiting the walkthrough recording.

## Latest version — background music, effects, and exports

### Added

- Optional Upbeat and Chill background music with an adjustable 0–25% music level.
- Automatic music ducking under dialogue, output limiting, and an end fade.
- Optional gentle alternating punch-ins and subtle contrast/saturation enhancement.
- Sound and effects controls in the uploader and chosen-setting summaries on results.
- CSV export for every clip in the current job: filenames, titles, hooks, rationale, duration, style, music, effects, dates, source ranges, and video/subtitle/results links.
- CSV escaping and spreadsheet formula-injection protection.
- Original synthesized music loops and production-build asset copying.

### Preserved

- Real transcription and AI-selected montage variations.
- HDR-to-SDR portrait H.264/AAC rendering.
- Six caption presets, burned-in captions, SRT and ASS downloads.
- Existing job regeneration, cleanup, and confirmed deletion behavior.
- Safe defaults for older jobs: no background music or effects.

### Verification

- API and frontend type checks and production builds passed during implementation.
- Render-helper and CSV unit tests passed.
- A 14.72-second enhanced clip from real HDR MOV footage passed browser playback, seeking, MP4/SRT/ASS downloads, reload, and full FFmpeg decode.
- CSV download and persisted music/effects settings were checked in the browser.

These checks describe the implementation verification, not a guarantee of future hosting uptime or a complete security audit.
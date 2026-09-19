import { randomUUID } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import {
  CreateJobBody,
  DeleteJobParams,
  DownloadClipParams,
  DownloadClipStyledSubtitlesParams,
  DownloadClipSubtitlesParams,
  GetJobParams,
  RegenerateJobParams,
} from "@workspace/api-zod";
import { db, yappingClipsTable, yappingJobsTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { queueJobProcessing } from "../lib/yappingProcessor";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const mutatingJobs = new Set<string>();

// A deletion and regeneration must never operate on the same files at once.
function serializeMutation(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    const id = String(req.params.jobId);
    if (mutatingJobs.has(id)) {
      res.status(409).json({ error: "Another change to this job is already in progress." });
      return;
    }
    mutatingJobs.add(id);
    try {
      await handler(req, res, next);
    } finally {
      mutatingJobs.delete(id);
    }
  };
}

type StoredSegment = { start: number; end: number };
type StoredTranscriptSegment = StoredSegment & { text: string };
type EditOptions = {
  music: "off" | "upbeat" | "chill";
  effects: "none" | "punchy";
  musicVolume: number;
};
type StoredRender = {
  segments: StoredSegment[];
  srtObjectPath: string;
  assObjectPath?: string;
};
type StoredTranscription = {
  text?: string;
  segments: StoredTranscriptSegment[];
  renders: Record<string, StoredRender>;
  editOptions: EditOptions;
};

function readStoredTranscription(value: unknown): StoredTranscription | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const segments = (Array.isArray(candidate.segments) ? candidate.segments : []).filter(
    (segment): segment is StoredTranscriptSegment =>
      !!segment &&
      typeof segment === "object" &&
      Number.isFinite((segment as StoredTranscriptSegment).start) &&
      Number.isFinite((segment as StoredTranscriptSegment).end) &&
      typeof (segment as StoredTranscriptSegment).text === "string",
  );
  const renders: Record<string, StoredRender> = {};
  if (candidate.renders && typeof candidate.renders === "object" && !Array.isArray(candidate.renders)) {
    for (const [clipId, value] of Object.entries(candidate.renders)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const render = value as Record<string, unknown>;
      if (typeof render.srtObjectPath !== "string" || !Array.isArray(render.segments)) continue;
      const renderSegments = render.segments.filter(
        (segment): segment is StoredSegment =>
          !!segment &&
          typeof segment === "object" &&
          Number.isFinite((segment as StoredSegment).start) &&
          Number.isFinite((segment as StoredSegment).end),
      );
      renders[clipId] = {
        segments: renderSegments,
        srtObjectPath: render.srtObjectPath,
        ...(typeof render.assObjectPath === "string"
          ? { assObjectPath: render.assObjectPath }
          : {}),
      };
    }
  }

  const rawOptions =
    candidate.editOptions &&
    typeof candidate.editOptions === "object" &&
    !Array.isArray(candidate.editOptions)
      ? (candidate.editOptions as Record<string, unknown>)
      : {};
  const editOptions: EditOptions = {
    music:
      rawOptions.music === "upbeat" || rawOptions.music === "chill"
        ? rawOptions.music
        : "off",
    effects: rawOptions.effects === "punchy" ? "punchy" : "none",
    musicVolume:
      typeof rawOptions.musicVolume === "number" &&
      rawOptions.musicVolume >= 0 &&
      rawOptions.musicVolume <= 0.25
        ? rawOptions.musicVolume
        : 0.1,
  };

  return {
    ...(typeof candidate.text === "string" ? { text: candidate.text } : {}),
    segments,
    renders,
    editOptions,
  };
}

router.post("/jobs", async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { objectPath, originalFilename, clipCount, clipLength, style } = parsed.data;
  const editOptions: EditOptions = {
    music: parsed.data.editOptions?.music ?? "off",
    effects: parsed.data.editOptions?.effects ?? "none",
    musicVolume: parsed.data.editOptions?.musicVolume ?? 0.1,
  };
  try {
    await objectStorageService.getObjectEntityFile(objectPath);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(400).json({ error: "Uploaded video was not found in App Storage" });
      return;
    }
    throw error;
  }

  const id = randomUUID();
  const [job] = await db
    .insert(yappingJobsTable)
    .values({
      id,
      originalFilename,
      sourceObjectPath: objectPath,
      requestedClips: clipCount,
      clipLength,
      style,
      transcription: { editOptions },
      deleteAfter: new Date(Date.now() + 48 * 60 * 60 * 1000),
    })
    .returning();

  queueJobProcessing(id);
  res.status(202).json(await serializeJob(job.id));
});

router.get("/jobs/:jobId", async (req, res): Promise<void> => {
  const parsed = GetJobParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const job = await serializeJob(parsed.data.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

router.delete("/jobs/:jobId", serializeMutation(async (req, res): Promise<void> => {
  const parsed = DeleteJobParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const job = await db
    .select()
    .from(yappingJobsTable)
    .where(eq(yappingJobsTable.id, parsed.data.jobId))
    .then((rows) => rows[0]);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (!["COMPLETE", "FAILED"].includes(job.status)) {
    res.status(409).json({ error: "Active processing jobs cannot be deleted." });
    return;
  }

  const clips = await db
    .select()
    .from(yappingClipsTable)
    .where(eq(yappingClipsTable.jobId, job.id));
  const transcription = readStoredTranscription(job.transcription);
  const objectPaths = new Set<string>([
    job.sourceObjectPath,
    ...clips.map((clip) => clip.objectPath),
  ]);
  for (const render of Object.values(transcription?.renders ?? {})) {
    objectPaths.add(render.srtObjectPath);
    if (render.assObjectPath) objectPaths.add(render.assObjectPath);
  }

  try {
    for (const objectPath of objectPaths) {
      try {
        const file = await objectStorageService.getObjectEntityFile(objectPath);
        await file.delete();
      } catch (error) {
        if (
          error instanceof ObjectNotFoundError ||
          (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            Number((error as { code: unknown }).code) === 404)
        ) {
          continue;
        }
        throw new Error(`Failed to delete stored file ${objectPath}`, { cause: error });
      }
    }
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to delete stored job files",
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(yappingClipsTable).where(eq(yappingClipsTable.jobId, job.id));
    await tx.delete(yappingJobsTable).where(eq(yappingJobsTable.id, job.id));
  });
  res.status(204).end();
}));

router.post("/jobs/:jobId/regenerate", serializeMutation(async (req, res): Promise<void> => {
  const parsed = RegenerateJobParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [job] = await db
    .select()
    .from(yappingJobsTable)
    .where(eq(yappingJobsTable.id, parsed.data.jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!["COMPLETE", "FAILED"].includes(job.status)) {
    res.status(409).json({ error: "This video is already processing." });
    return;
  }

  await db
    .update(yappingJobsTable)
    .set({
      status: "UPLOADED",
      progress: 5,
      currentStep: "Preparing to render your clip again",
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(yappingJobsTable.id, job.id));
  queueJobProcessing(job.id, true);
  res.status(202).json(await serializeJob(job.id));
}));

router.get(
  "/jobs/:jobId/clips/:clipId/download",
  async (req, res): Promise<void> => {
    const clipParams = DownloadClipParams.safeParse(req.params);
    if (!clipParams.success) {
      res.status(400).json({ error: clipParams.error.message });
      return;
    }
    const clip = await db
      .select()
      .from(yappingClipsTable)
      .where(
        and(
          eq(yappingClipsTable.id, clipParams.data.clipId),
          eq(yappingClipsTable.jobId, clipParams.data.jobId),
        ),
      )
      .then((rows) => rows[0]);
    if (!clip) {
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    const file = await objectStorageService.getObjectEntityFile(clip.objectPath);
    const response = await objectStorageService.downloadObject(file, 3600);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="yapping-clip-${clip.clipIndex + 1}.mp4"`,
    );
    if (response.body) {
      const { Readable } = await import("node:stream");
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.setMaxListeners(0);
      nodeStream.pipe(res);
      return;
    }
    res.end();
  },
);

router.get(
  "/jobs/:jobId/clips/:clipId/subtitles",
  async (req, res): Promise<void> => {
    const params = DownloadClipSubtitlesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [clip, job] = await Promise.all([
      db
        .select()
        .from(yappingClipsTable)
        .where(
          and(
            eq(yappingClipsTable.id, params.data.clipId),
            eq(yappingClipsTable.jobId, params.data.jobId),
          ),
        )
        .then((rows) => rows[0]),
      db
        .select()
        .from(yappingJobsTable)
        .where(eq(yappingJobsTable.id, params.data.jobId))
        .then((rows) => rows[0]),
    ]);
    if (!clip || !job) {
      res.status(404).json({ error: "Clip not found" });
      return;
    }

    const render = readStoredTranscription(job.transcription)?.renders[clip.id];
    if (!render?.srtObjectPath) {
      res.status(404).json({ error: "Subtitles not found" });
      return;
    }

    try {
      const file = await objectStorageService.getObjectEntityFile(render.srtObjectPath);
      const response = await objectStorageService.downloadObject(file, 3600);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="yapping-clip-${clip.clipIndex + 1}.srt"`,
      );
      if (response.body) {
        const { Readable } = await import("node:stream");
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.setMaxListeners(0);
        nodeStream.pipe(res);
        return;
      }
      res.end();
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Subtitles not found" });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/jobs/:jobId/clips/:clipId/styled-subtitles",
  async (req, res): Promise<void> => {
    const params = DownloadClipStyledSubtitlesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [clip, job] = await Promise.all([
      db
        .select()
        .from(yappingClipsTable)
        .where(
          and(
            eq(yappingClipsTable.id, params.data.clipId),
            eq(yappingClipsTable.jobId, params.data.jobId),
          ),
        )
        .then((rows) => rows[0]),
      db
        .select()
        .from(yappingJobsTable)
        .where(eq(yappingJobsTable.id, params.data.jobId))
        .then((rows) => rows[0]),
    ]);
    if (!clip || !job) {
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    const assObjectPath = readStoredTranscription(job.transcription)?.renders[clip.id]
      ?.assObjectPath;
    if (!assObjectPath) {
      res.status(404).json({ error: "Styled subtitles not found" });
      return;
    }
    try {
      const file = await objectStorageService.getObjectEntityFile(assObjectPath);
      const response = await objectStorageService.downloadObject(file, 3600);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("Content-Type", "text/x-ssa; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="yapping-clip-${clip.clipIndex + 1}.ass"`,
      );
      if (response.body) {
        const { Readable } = await import("node:stream");
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.setMaxListeners(0);
        nodeStream.pipe(res);
        return;
      }
      res.end();
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Styled subtitles not found" });
        return;
      }
      throw error;
    }
  },
);

async function serializeJob(jobId: string) {
  const [job] = await db
    .select()
    .from(yappingJobsTable)
    .where(eq(yappingJobsTable.id, jobId));
  if (!job) return null;

  const clips = await db
    .select()
    .from(yappingClipsTable)
    .where(eq(yappingClipsTable.jobId, jobId));
  const transcription = readStoredTranscription(job.transcription);

  return {
    id: job.id,
    filename: job.originalFilename,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    requestedClips: job.requestedClips,
    clipLength: job.clipLength,
    style: job.style,
    editOptions: transcription?.editOptions ?? {
      music: "off",
      effects: "none",
      musicVolume: 0.1,
    },
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    ...(transcription?.text
      ? {
          transcription: {
            text: transcription.text,
            segments: transcription.segments,
          },
        }
      : {}),
    clips: clips
      .sort((a, b) => a.clipIndex - b.clipIndex)
      .map((clip) => {
        const render = transcription?.renders[clip.id];
        return {
          id: clip.id,
          index: clip.clipIndex,
          title: clip.title,
          hook: clip.hook,
          reason: clip.reason,
          duration: Number(clip.duration),
          downloadUrl: `/api/jobs/${job.id}/clips/${clip.id}/download`,
          previewUrl: `/api/storage${clip.objectPath}`,
          ...(render
            ? {
                sourceSegments: render.segments,
                subtitleUrl: `/api/jobs/${job.id}/clips/${clip.id}/subtitles`,
                ...(render.assObjectPath
                  ? {
                      styledSubtitleUrl: `/api/jobs/${job.id}/clips/${clip.id}/styled-subtitles`,
                    }
                  : {}),
              }
            : {}),
        };
      }),
  };
}

export default router;
import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const yappingJobsTable = pgTable("yapping_jobs", {
  id: text("id").primaryKey(),
  originalFilename: text("original_filename").notNull(),
  sourceObjectPath: text("source_object_path").notNull(),
  status: text("status").notNull().default("UPLOADED"),
  progress: integer("progress").notNull().default(5),
  currentStep: text("current_step").notNull().default("Upload complete"),
  requestedClips: integer("requested_clips").notNull(),
  clipLength: text("clip_length").notNull(),
  style: text("style").notNull(),
  transcription: jsonb("transcription"),
  error: text("error"),
  deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const yappingClipsTable = pgTable("yapping_clips", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => yappingJobsTable.id, { onDelete: "cascade" }),
  clipIndex: integer("clip_index").notNull(),
  title: text("title").notNull(),
  hook: text("hook").notNull(),
  reason: text("reason").notNull(),
  duration: numeric("duration").notNull(),
  sourceStart: numeric("source_start").notNull(),
  sourceEnd: numeric("source_end").notNull(),
  objectPath: text("object_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertYappingJobSchema = createInsertSchema(yappingJobsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertYappingJob = z.infer<typeof insertYappingJobSchema>;
export type YappingJob = typeof yappingJobsTable.$inferSelect;
export type YappingClip = typeof yappingClipsTable.$inferSelect;
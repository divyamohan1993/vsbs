// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
//
// Zod schemas for the demo-recording orchestrator. The progress-event shape
// is the wire contract between tools/carla/scripts/record_demo.sh and the
// orchestrator (apps/api/src/adapters/recordings/orchestrator.ts).
//
// Every JSON_PROGRESS line emitted by the shell script and every entry
// surfaced through the SSE stream parses against RecordingProgressEventSchema.
// Type-safe at every boundary, no implicit fields.

import { z } from "zod";

export const RecordingCategorySchema = z.enum([
  "recording",
  "carla",
  "bridge",
  "scenario",
  "encoding",
  "done",
]);
export type RecordingCategory = z.infer<typeof RecordingCategorySchema>;

export const RecordingSeveritySchema = z.enum(["info", "watch", "alert"]);
export type RecordingSeverity = z.infer<typeof RecordingSeveritySchema>;

export const RecordingProgressEventSchema = z.object({
  ts: z.string().datetime(),
  category: RecordingCategorySchema,
  severity: RecordingSeveritySchema,
  title: z.string().min(1).max(160),
  detail: z.string().max(500).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type RecordingProgressEvent = z.infer<typeof RecordingProgressEventSchema>;

export const RecordingEncoderSchema = z.enum([
  "hevc_nvenc",
  "h264_nvenc",
  "libx264",
  "libx265",
  "synthetic",
]);
export type RecordingEncoder = z.infer<typeof RecordingEncoderSchema>;

export const RecordingStatusSchema = z.enum([
  "queued",
  "running",
  "encoding",
  "done",
  "error",
]);
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

export const RecordingStartBodySchema = z.object({
  durationS: z.number().int().min(60).max(1_800),
  useCarlaIfAvailable: z.boolean().default(true),
  label: z.string().max(80).optional(),
});
export type RecordingStartBody = z.infer<typeof RecordingStartBodySchema>;

export const RecordingSummarySchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  durationS: z.number().int().min(60).max(1_800),
  useCarlaIfAvailable: z.boolean(),
  label: z.string().max(80).optional(),
  status: RecordingStatusSchema,
  encoder: RecordingEncoderSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  completedAt: z.string().datetime().optional(),
  errorMessage: z.string().max(500).optional(),
});
export type RecordingSummary = z.infer<typeof RecordingSummarySchema>;

export const RecordingDownloadEventSchema = z.object({
  url: z.string().min(1),
  posterUrl: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  durationS: z.number().int().nonnegative(),
  encoder: RecordingEncoderSchema,
});
export type RecordingDownloadEvent = z.infer<typeof RecordingDownloadEventSchema>;

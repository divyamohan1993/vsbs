// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
//
// /v1/recordings — demo-recording orchestrator HTTP API.
//
//   POST /start                 kick off a new recording (one at a time)
//   GET  /                      list last 50 recordings
//   GET  /:id                   summary for a single id
//   GET  /:id/progress/sse      live JSON_PROGRESS feed + replay
//   GET  /:id/file              composite mp4 download
//   GET  /:id/poster.jpg        3-up poster (lazy ffmpeg)

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { existsSync, readFileSync, statSync } from "node:fs";

import { errBody, type AppEnv } from "../middleware/security.js";
import { zv } from "../middleware/zv.js";
import {
  RecordingStartBodySchema,
  type RecordingDownloadEvent,
  type RecordingProgressEvent,
} from "../adapters/recordings/types.js";
import {
  RecordingBusyError,
  RecordingOrchestrator,
} from "../adapters/recordings/orchestrator.js";
import { type RecordingsHub } from "../adapters/recordings/recordings-hub.js";
import { type RecordingsStorage } from "../adapters/recordings/storage.js";
import {
  PosterUnavailableError,
  generatePoster,
  type PosterDeps,
} from "../adapters/recordings/poster.js";

export interface BuildRecordingsRouterOptions {
  orchestrator: RecordingOrchestrator;
  hub: RecordingsHub;
  storage: RecordingsStorage;
  /** Inject ffmpeg poster generator deps for tests. */
  posterDeps?: PosterDeps;
}

const IdParam = z.object({ id: z.string().uuid() });

export function buildRecordingsRouter(opts: BuildRecordingsRouterOptions) {
  const { orchestrator, hub, storage, posterDeps } = opts;
  const router = new Hono<AppEnv>();

  router.post("/start", zv("json", RecordingStartBodySchema), async (c) => {
    const body = c.req.valid("json");
    try {
      const { id, startedAt } = await orchestrator.start(body);
      return c.json(
        {
          data: {
            id,
            startedAt,
            statusSseUrl: `/v1/recordings/${id}/progress/sse`,
            fileUrl: `/v1/recordings/${id}/file`,
            posterUrl: `/v1/recordings/${id}/poster.jpg`,
          },
        },
        202,
      );
    } catch (err) {
      if (err instanceof RecordingBusyError) {
        return c.json(
          errBody("RECORDING_BUSY", `Recording ${err.currentId} is in progress`, c, {
            currentId: err.currentId,
          }),
          409,
        );
      }
      return c.json(errBody("RECORDING_START_FAILED", String(err), c), 500);
    }
  });

  router.get("/", async (c) => {
    const items = await storage.readIndex();
    return c.json({ data: { items } });
  });

  router.get("/:id", zv("param", IdParam), async (c) => {
    const { id } = c.req.valid("param");
    const fromHub = hub.getSummary(id);
    if (fromHub) return c.json({ data: fromHub });
    const idx = await storage.readIndex();
    const found = idx.find((r) => r.id === id);
    if (!found) {
      return c.json(errBody("RECORDING_NOT_FOUND", "No recording with that id", c), 404);
    }
    return c.json({ data: found });
  });

  router.get("/:id/progress/sse", zv("param", IdParam), (c) => {
    const { id } = c.req.valid("param");
    return streamSSE(c, async (stream) => {
      // Replay every cached event so a late subscriber lands on the same
      // state the first viewer saw. Hub holds the in-memory ring; the disk
      // log is the canonical source for completed recordings.
      const cached = hub.recentProgress(id);
      const replay: RecordingProgressEvent[] =
        cached.length > 0 ? cached : await storage.readEventLog(id);
      for (const e of replay) {
        await stream.writeSSE({ event: "progress", data: JSON.stringify(e) });
      }
      const initialDownload = hub.latestDownload(id);
      if (initialDownload) {
        await stream.writeSSE({
          event: "download",
          data: JSON.stringify(initialDownload),
        });
      }
      const hubSummary = hub.getSummary(id);
      const indexSummary =
        hubSummary ?? (await storage.readIndex()).find((r) => r.id === id) ?? null;
      if (
        indexSummary &&
        (indexSummary.status === "done" || indexSummary.status === "error")
      ) {
        await stream.writeSSE({
          event: indexSummary.status === "error" ? "error" : "end",
          data: JSON.stringify(indexSummary),
        });
        return;
      }

      const queue: Array<
        | { kind: "progress"; event: RecordingProgressEvent }
        | { kind: "download"; event: RecordingDownloadEvent }
      > = [];
      let resolve: (() => void) | null = null;
      const wake = (): void => {
        const r = resolve;
        resolve = null;
        if (r) r();
      };
      const unsubProgress = hub.subscribeProgress(id, (event) => {
        queue.push({ kind: "progress", event });
        wake();
      });
      const unsubDownload = hub.subscribeDownload(id, (event) => {
        queue.push({ kind: "download", event });
        wake();
      });
      try {
        while (!stream.aborted) {
          while (queue.length > 0) {
            const next = queue.shift();
            if (!next) break;
            if (next.kind === "progress") {
              await stream.writeSSE({
                event: "progress",
                data: JSON.stringify(next.event),
              });
              if (next.event.category === "done") {
                const sum = hub.getSummary(id);
                if (sum && (sum.status === "done" || sum.status === "error")) {
                  await stream.writeSSE({
                    event: sum.status === "error" ? "error" : "end",
                    data: JSON.stringify(sum),
                  });
                  return;
                }
              }
            } else {
              await stream.writeSSE({
                event: "download",
                data: JSON.stringify(next.event),
              });
            }
          }
          await Promise.race([
            new Promise<void>((res) => {
              resolve = res;
            }),
            stream.sleep(15_000),
          ]);
          if (queue.length === 0 && !stream.aborted) {
            await stream.writeSSE({
              event: "ping",
              data: JSON.stringify({ ts: new Date().toISOString() }),
            });
          }
        }
      } finally {
        unsubProgress();
        unsubDownload();
      }
    });
  });

  router.get("/:id/file", zv("param", IdParam), (c) => {
    const { id } = c.req.valid("param");
    const file = storage.recordingFilePath(id);
    if (!existsSync(file)) {
      return c.json(errBody("RECORDING_FILE_NOT_FOUND", "Recording file missing", c), 404);
    }
    const size = statSync(file).size;
    const stream =
      typeof (globalThis as unknown as { Bun?: { file: (p: string) => { stream: () => ReadableStream } } }).Bun?.file === "function"
        ? (globalThis as unknown as { Bun: { file: (p: string) => { stream: () => ReadableStream } } }).Bun.file(file).stream()
        : nodeStreamToWeb(file);
    c.header("content-type", "video/mp4");
    c.header("content-length", String(size));
    c.header("content-disposition", `attachment; filename="vsbs-demo-${id}.mp4"`);
    c.header("accept-ranges", "bytes");
    return c.body(stream);
  });

  router.get("/:id/poster.jpg", zv("param", IdParam), async (c) => {
    const { id } = c.req.valid("param");
    const mp4 = storage.recordingFilePath(id);
    if (!existsSync(mp4)) {
      return c.json(errBody("RECORDING_FILE_NOT_FOUND", "Recording mp4 missing", c), 404);
    }
    const poster = storage.posterFilePath(id);
    if (!existsSync(poster)) {
      try {
        await generatePoster(mp4, poster, posterDeps ?? {});
      } catch (err) {
        if (err instanceof PosterUnavailableError) {
          return c.json(errBody("POSTER_UNAVAILABLE", err.message, c), 503);
        }
        return c.json(errBody("POSTER_FAILED", String(err), c), 500);
      }
    }
    const size = statSync(poster).size;
    const stream =
      typeof (globalThis as unknown as { Bun?: { file: (p: string) => { stream: () => ReadableStream } } }).Bun?.file === "function"
        ? (globalThis as unknown as { Bun: { file: (p: string) => { stream: () => ReadableStream } } }).Bun.file(poster).stream()
        : nodeStreamToWeb(poster);
    c.header("content-type", "image/jpeg");
    c.header("content-length", String(size));
    c.header("cache-control", "public, max-age=3600");
    return c.body(stream);
  });

  return router;
}

function nodeStreamToWeb(file: string): ReadableStream<Uint8Array> {
  // Fallback when running under plain Node (vitest); Bun.file is not present.
  // Loads the file in O(size) — fine for the 5-30 MB demo posters and
  // dashboard mp4s we produce. Never used in production where Bun is the runtime.
  const buf = readFileSync(file);
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}

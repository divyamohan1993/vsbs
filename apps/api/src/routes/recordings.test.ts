// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { buildRecordingsRouter } from "./recordings.js";
import { requestId, type AppEnv } from "../middleware/security.js";
import {
  RecordingOrchestrator,
  type SpawnFn,
  type SpawnedProcess,
} from "../adapters/recordings/orchestrator.js";
import { RecordingsHub } from "../adapters/recordings/recordings-hub.js";
import { RecordingsStorage } from "../adapters/recordings/storage.js";
import type { RecordingProgressEvent, RecordingSummary } from "../adapters/recordings/types.js";

interface FakeChild extends SpawnedProcess {
  pushStdout(line: string): void;
  finish(code?: number): void;
}

function makeFakeSpawn(): { spawn: SpawnFn; children: FakeChild[] } {
  const children: FakeChild[] = [];
  const spawn: SpawnFn = () => {
    let stdoutController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stdout = new ReadableStream<Uint8Array>({
      start(c) {
        stdoutController = c;
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    });
    let resolveExit!: (n: number) => void;
    const exited = new Promise<number>((res) => {
      resolveExit = res;
    });
    const child: FakeChild = {
      stdout,
      stderr,
      exited,
      pid: 9001,
      kill: () => undefined,
      pushStdout(line: string) {
        if (!stdoutController) return;
        stdoutController.enqueue(new TextEncoder().encode(`${line}\n`));
      },
      finish(code = 0) {
        try {
          stdoutController?.close();
        } catch {
          /* ignore */
        }
        resolveExit(code);
      },
    };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

let workDir: string;
let storage: RecordingsStorage;
let hub: RecordingsHub;
let orchestrator: RecordingOrchestrator;
let spawn: SpawnFn;
let children: FakeChild[];

const FIXED_ID = "11111111-2222-4333-8444-555555555555";
const FIXED_NOW = new Date("2026-05-02T12:34:56.000Z");

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.route(
    "/v1/recordings",
    buildRecordingsRouter({
      orchestrator,
      hub,
      storage,
      posterDeps: {
        spawn: () => ({ exited: Promise.resolve(0) }),
        statFn: async () => ({ size: 1234 }),
      },
    }),
  );
  return app;
}

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "vsbs-routes-"));
  storage = new RecordingsStorage({ root: workDir });
  await storage.ensureDir();
  hub = new RecordingsHub();
  const fake = makeFakeSpawn();
  spawn = fake.spawn;
  children = fake.children;
  orchestrator = new RecordingOrchestrator({
    hub,
    storage,
    spawn,
    repoRoot: workDir,
    scriptPath: "/usr/bin/true",
    apiBase: "http://localhost:0",
    hostEnv: { PATH: "/usr/bin" },
    now: () => FIXED_NOW,
    idFactory: () => FIXED_ID,
    hardTimeoutMs: () => 5_000,
  });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function startAndComplete(): Promise<RecordingSummary> {
  const app = buildApp();
  const start = await app.request("/v1/recordings/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ durationS: 60, useCarlaIfAvailable: false, label: "demo" }),
  });
  expect(start.status).toBe(202);
  const child = children[0]!;
  await writeFile(storage.recordingFilePath(FIXED_ID), "0123456789");
  child.pushStdout(
    `JSON_PROGRESS ${JSON.stringify({
      ts: FIXED_NOW.toISOString(),
      category: "encoding",
      severity: "info",
      title: "Encoding composite-complete",
      data: { sizeBytes: 10, durationS: 60, encoder: "libx264" },
    })}`,
  );
  child.finish(0);
  await new Promise((r) => setTimeout(r, 30));
  const summary = hub.getSummary(FIXED_ID);
  expect(summary).not.toBeNull();
  return summary!;
}

describe("recordings router", () => {
  it("POST /start returns 202 + URLs", async () => {
    const app = buildApp();
    const res = await app.request("/v1/recordings/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ durationS: 60, useCarlaIfAvailable: true }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.id).toBe(FIXED_ID);
    expect(body.data.statusSseUrl).toBe(`/v1/recordings/${FIXED_ID}/progress/sse`);
    expect(body.data.fileUrl).toBe(`/v1/recordings/${FIXED_ID}/file`);
    expect(body.data.posterUrl).toBe(`/v1/recordings/${FIXED_ID}/poster.jpg`);
    children[0]!.finish(0);
    await new Promise((r) => setTimeout(r, 20));
  });

  it("POST /start rejects malformed bodies via Zod validator", async () => {
    const app = buildApp();
    const res = await app.request("/v1/recordings/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ durationS: 5, useCarlaIfAvailable: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("POST /start while one is in flight returns 409 RECORDING_BUSY", async () => {
    const app = buildApp();
    await app.request("/v1/recordings/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ durationS: 60, useCarlaIfAvailable: false }),
    });
    const res = await app.request("/v1/recordings/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ durationS: 60, useCarlaIfAvailable: false }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("RECORDING_BUSY");
    children[0]!.finish(0);
    await new Promise((r) => setTimeout(r, 20));
  });

  it("GET /:id returns 404 for unknown ids", async () => {
    const app = buildApp();
    const ghost = "99999999-9999-4999-8999-999999999999";
    const res = await app.request(`/v1/recordings/${ghost}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("RECORDING_NOT_FOUND");
  });

  it("GET / returns the index in reverse-chronological order", async () => {
    const summary = await startAndComplete();
    const app = buildApp();
    const res = await app.request("/v1/recordings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items[0].id).toBe(summary.id);
  });

  it("GET /:id returns the hub-cached summary", async () => {
    const summary = await startAndComplete();
    const app = buildApp();
    const res = await app.request(`/v1/recordings/${summary.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(summary.id);
    expect(body.data.status).toBe("done");
  });

  it("GET /:id/file streams the mp4 with content-disposition", async () => {
    const summary = await startAndComplete();
    const app = buildApp();
    const res = await app.request(`/v1/recordings/${summary.id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="vsbs-demo-${summary.id}.mp4"`,
    );
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(10);
  });

  it("GET /:id/file returns 404 when the mp4 is missing", async () => {
    const ghost = "33333333-4444-4444-8444-444444444444";
    const app = buildApp();
    const res = await app.request(`/v1/recordings/${ghost}/file`);
    expect(res.status).toBe(404);
  });

  it("GET /:id/poster.jpg generates and caches the poster", async () => {
    const summary = await startAndComplete();
    // Pre-create a poster on disk so the route returns it without spawning.
    await writeFile(storage.posterFilePath(summary.id), Buffer.from([0xff, 0xd8, 0xff]));
    const app = buildApp();
    const res = await app.request(`/v1/recordings/${summary.id}/poster.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("GET /:id/progress/sse replays cached events on connect", async () => {
    const summary = await startAndComplete();
    const app = buildApp();
    const res = await app.request(`/v1/recordings/${summary.id}/progress/sse`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: progress");
    expect(text).toMatch(/event: (download|end)/);
  });

  it("GET /:id/progress/sse returns end terminal for completed runs", async () => {
    const summary = await startAndComplete();
    const app = buildApp();
    const res = await app.request(`/v1/recordings/${summary.id}/progress/sse`);
    const text = await res.text();
    expect(text).toContain("event: end");
    expect(text).toContain(`"id":"${summary.id}"`);
  });

  it("GET /:id/progress/sse falls back to disk event log when hub is empty", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    const e: RecordingProgressEvent = {
      ts: FIXED_NOW.toISOString(),
      category: "scenario",
      severity: "info",
      title: "from-disk",
    };
    await storage.appendEventLog(id, e);
    await storage.appendIndex({
      id,
      startedAt: FIXED_NOW.toISOString(),
      durationS: 60,
      useCarlaIfAvailable: false,
      status: "done",
      sizeBytes: 1,
      encoder: "libx264",
      completedAt: FIXED_NOW.toISOString(),
    });
    const app = buildApp();
    const res = await app.request(`/v1/recordings/${id}/progress/sse`);
    const text = await res.text();
    expect(text).toContain("from-disk");
    expect(text).toContain("event: end");
  });
});

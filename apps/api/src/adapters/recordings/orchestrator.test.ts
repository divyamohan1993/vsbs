// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  RecordingBusyError,
  RecordingOrchestrator,
  type SpawnFn,
  type SpawnOptions,
  type SpawnedProcess,
} from "./orchestrator.js";
import { RecordingsHub } from "./recordings-hub.js";
import { RecordingsStorage } from "./storage.js";
import type { RecordingProgressEvent } from "./types.js";

interface FakeChild extends SpawnedProcess {
  /** Push a stdout line into the child as if the script wrote it. */
  pushStdout(line: string): void;
  /** Push a stderr line. */
  pushStderr(line: string): void;
  /** Resolve the exit promise with the given code. */
  finish(code?: number): void;
  /** Inspect what was passed to spawn. */
  options: SpawnOptions;
  killSignals: Array<number | string | undefined>;
}

function makeFakeSpawn(): {
  spawn: SpawnFn;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  const spawn: SpawnFn = (opts) => {
    let stdoutController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let stderrController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stdout = new ReadableStream<Uint8Array>({
      start(c) {
        stdoutController = c;
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(c) {
        stderrController = c;
      },
    });
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((res) => {
      resolveExit = res;
    });
    const killSignals: Array<number | string | undefined> = [];
    const child: FakeChild = {
      stdout,
      stderr,
      exited,
      pid: 1234,
      kill: (signal) => {
        killSignals.push(signal);
      },
      pushStdout(line: string) {
        if (!stdoutController) return;
        stdoutController.enqueue(new TextEncoder().encode(`${line}\n`));
      },
      pushStderr(line: string) {
        if (!stderrController) return;
        stderrController.enqueue(new TextEncoder().encode(`${line}\n`));
      },
      finish(code = 0) {
        try {
          stdoutController?.close();
        } catch {
          /* ignore */
        }
        try {
          stderrController?.close();
        } catch {
          /* ignore */
        }
        resolveExit(code);
      },
      options: opts,
      killSignals,
    };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

let workDir: string;
let storage: RecordingsStorage;
let hub: RecordingsHub;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "vsbs-orch-"));
  storage = new RecordingsStorage({ root: workDir });
  await storage.ensureDir();
  hub = new RecordingsHub();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const FIXED_ID = "fedcba98-7654-4321-8abc-fedcba987654";
const FIXED_NOW = new Date("2026-05-02T12:00:00.000Z");

function progressLine(event: Partial<RecordingProgressEvent>): string {
  const base: RecordingProgressEvent = {
    ts: FIXED_NOW.toISOString(),
    category: "scenario",
    severity: "info",
    title: "marker",
    ...event,
  } as RecordingProgressEvent;
  return `JSON_PROGRESS ${JSON.stringify(base)}`;
}

function buildOrchestrator(spawn: SpawnFn): RecordingOrchestrator {
  return new RecordingOrchestrator({
    hub,
    storage,
    spawn,
    repoRoot: workDir,
    scriptPath: "/usr/bin/true",
    apiBase: "http://localhost:0",
    hostEnv: { PATH: "/usr/bin", DISPLAY: ":99", HOME: "/tmp", SECRET_TOKEN: "leak-me" },
    now: () => FIXED_NOW,
    idFactory: () => FIXED_ID,
    hardTimeoutMs: () => 5_000,
  });
}

describe("RecordingOrchestrator", () => {
  it("emits Recording starting and parses JSON_PROGRESS lines on stdout", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    const seen: RecordingProgressEvent[] = [];
    hub.subscribeProgress(FIXED_ID, (e) => seen.push(e));

    const start = await orch.start({ durationS: 60, useCarlaIfAvailable: false });
    expect(start.id).toBe(FIXED_ID);

    const child = children[0]!;
    child.pushStdout(progressLine({ category: "carla", title: "CARLA absent" }));
    child.pushStdout(progressLine({ category: "bridge", title: "Bridge ready" }));
    // Write a fake mp4 so the finalise step picks up encoder + size.
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

    const titles = seen.map((e) => e.title);
    expect(titles[0]).toContain("Recording starting");
    expect(titles).toContain("CARLA absent");
    expect(titles).toContain("Bridge ready");
    expect(titles).toContain("Encoding composite-complete");
    const summary = hub.getSummary(FIXED_ID);
    expect(summary?.status).toBe("done");
    expect(summary?.encoder).toBe("libx264");
    expect(summary?.sizeBytes).toBe(10);
  });

  it("publishes a download envelope after a successful run", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    let download: unknown = null;
    hub.subscribeDownload(FIXED_ID, (e) => {
      download = e;
    });
    await orch.start({ durationS: 60, useCarlaIfAvailable: false });
    const child = children[0]!;
    await writeFile(storage.recordingFilePath(FIXED_ID), "0123456789ABCDEF");
    child.pushStdout(
      `JSON_PROGRESS ${JSON.stringify({
        ts: FIXED_NOW.toISOString(),
        category: "encoding",
        severity: "info",
        title: "Encoding composite-complete",
        data: { sizeBytes: 16, durationS: 60, encoder: "libx264" },
      })}`,
    );
    child.finish(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(download).toMatchObject({
      url: `/v1/recordings/${FIXED_ID}/file`,
      posterUrl: `/v1/recordings/${FIXED_ID}/poster.jpg`,
      sizeBytes: 16,
      durationS: 60,
      encoder: "libx264",
    });
  });

  it("rejects a second concurrent start with RECORDING_BUSY", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    await orch.start({ durationS: 60, useCarlaIfAvailable: false });
    await expect(
      orch.start({ durationS: 60, useCarlaIfAvailable: false }),
    ).rejects.toBeInstanceOf(RecordingBusyError);
    children[0]!.finish(0);
    await new Promise((r) => setTimeout(r, 20));
  });

  it("hard-timeout sends SIGINT and emits a timeout event", async () => {
    vi.useFakeTimers();
    try {
      const { spawn, children } = makeFakeSpawn();
      const orch = buildOrchestrator(spawn);
      await orch.start({ durationS: 60, useCarlaIfAvailable: false });
      vi.advanceTimersByTime(6_000);
      const child = children[0]!;
      expect(child.killSignals).toContain("SIGINT");
      // Advance past the SIGKILL grace window.
      vi.advanceTimersByTime(6_000);
      expect(child.killSignals).toContain("SIGKILL");
      child.finish(137);
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      const titles = hub.recentProgress(FIXED_ID).map((e) => e.title);
      expect(titles).toContain("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("only forwards whitelisted env vars to the child", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    await orch.start({ durationS: 60, useCarlaIfAvailable: true });
    const env = children[0]!.options.env;
    expect(env.PATH).toBe("/usr/bin");
    expect(env.DISPLAY).toBe(":99");
    expect(env.HOME).toBe("/tmp");
    expect(env.RECORDING_ID).toBe(FIXED_ID);
    expect(env.RECORDING_DURATION_S).toBe("60");
    expect(env.RECORDING_USE_CARLA).toBe("true");
    expect(env.VSBS_API_BASE).toBe("http://localhost:0");
    expect(Object.keys(env)).not.toContain("SECRET_TOKEN");
    children[0]!.finish(0);
    await new Promise((r) => setTimeout(r, 20));
  });

  it("emits a watch event when stdout JSON fails to parse", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    const seen: RecordingProgressEvent[] = [];
    hub.subscribeProgress(FIXED_ID, (e) => seen.push(e));
    await orch.start({ durationS: 60, useCarlaIfAvailable: false });
    const child = children[0]!;
    child.pushStdout("JSON_PROGRESS {definitely not json");
    child.pushStdout("JSON_PROGRESS {\"category\":\"unknown-cat\",\"severity\":\"info\",\"title\":\"x\"}");
    child.finish(1);
    await new Promise((r) => setTimeout(r, 30));
    const watch = seen.find((e) => e.title === "json-parse-failed");
    expect(watch?.severity).toBe("watch");
    const mismatch = seen.find((e) => e.title === "schema-mismatch");
    expect(mismatch?.severity).toBe("watch");
  });

  it("marks the recording as error when exit != 0 and no mp4 is produced", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    await orch.start({ durationS: 60, useCarlaIfAvailable: false });
    children[0]!.finish(2);
    await new Promise((r) => setTimeout(r, 30));
    const summary = hub.getSummary(FIXED_ID);
    expect(summary?.status).toBe("error");
    const idx = await storage.readIndex();
    expect(idx[0]?.status).toBe("error");
  });

  it("forwards unstructured stdout lines as info diagnostics", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    const seen: RecordingProgressEvent[] = [];
    hub.subscribeProgress(FIXED_ID, (e) => seen.push(e));
    await orch.start({ durationS: 60, useCarlaIfAvailable: false });
    children[0]!.pushStdout("hello from the script");
    children[0]!.finish(0);
    await new Promise((r) => setTimeout(r, 20));
    const stdoutEvent = seen.find(
      (e) => e.title === "stdout" && (e.detail ?? "").includes("hello from the script"),
    );
    expect(stdoutEvent).toBeDefined();
  });

  it("forwards stderr lines as watch events", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    const seen: RecordingProgressEvent[] = [];
    hub.subscribeProgress(FIXED_ID, (e) => seen.push(e));
    await orch.start({ durationS: 60, useCarlaIfAvailable: false });
    children[0]!.pushStderr("ffmpeg: missing nvenc");
    children[0]!.finish(0);
    await new Promise((r) => setTimeout(r, 20));
    const stderrEvent = seen.find(
      (e) => e.title === "stderr" && (e.detail ?? "").includes("missing nvenc"),
    );
    expect(stderrEvent?.severity).toBe("watch");
  });

  it("appends each progress event to the on-disk JSONL log", async () => {
    const { spawn, children } = makeFakeSpawn();
    const orch = buildOrchestrator(spawn);
    await orch.start({ durationS: 60, useCarlaIfAvailable: false });
    children[0]!.pushStdout(progressLine({ category: "scenario", title: "Phase: cruise" }));
    children[0]!.finish(0);
    await new Promise((r) => setTimeout(r, 30));
    const log = await storage.readEventLog(FIXED_ID);
    expect(log.some((e) => e.title === "Phase: cruise")).toBe(true);
    expect(log.some((e) => e.title.includes("Recording starting"))).toBe(true);
  });
});

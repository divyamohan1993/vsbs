// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { RecordingsStorage } from "./storage.js";
import type { RecordingProgressEvent, RecordingSummary } from "./types.js";

let workDir: string;
let storage: RecordingsStorage;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "vsbs-rec-test-"));
  storage = new RecordingsStorage({ root: workDir });
  await storage.ensureDir();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function summary(
  id: string,
  startedAt: string,
  status: "running" | "done" | "error" = "done",
): RecordingSummary {
  return {
    id,
    startedAt,
    durationS: 60,
    useCarlaIfAvailable: false,
    status,
    ...(status === "done"
      ? { completedAt: startedAt, sizeBytes: 1234, encoder: "libx264" as const }
      : {}),
  };
}

const idAt = (n: number): string => {
  const hex = n.toString(16).padStart(2, "0");
  return `00000000-0000-4000-8000-0000000000${hex}`;
};

describe("RecordingsStorage", () => {
  it("rejects path-traversal attempts", () => {
    expect(() => storage.recordingFilePath("../../etc/passwd.mp4")).toThrow();
    expect(() => storage.recordingFilePath("foo/../bar")).toThrow();
    expect(() => storage.recordingFilePath("/etc/shadow")).toThrow();
    expect(() => storage.recordingFilePath("foo\0bar")).toThrow();
    expect(() => storage.recordingFilePath("")).toThrow();
  });

  it("returns paths inside the root for valid leaves", () => {
    const id = "abcd1234-abcd-4abc-8abc-abcdef012345";
    const file = storage.recordingFilePath(id);
    expect(file.startsWith(workDir)).toBe(true);
    expect(file.endsWith(`${id}.mp4`)).toBe(true);
  });

  it("readIndex returns [] when the index file is missing", async () => {
    expect(await storage.readIndex()).toEqual([]);
  });

  it("appendIndex writes atomically and survives concurrent writers", async () => {
    const a = summary(idAt(1), "2026-05-02T10:00:00.000Z");
    const b = summary(idAt(2), "2026-05-02T10:00:01.000Z");
    const c = summary(idAt(3), "2026-05-02T10:00:02.000Z");
    await Promise.all([
      storage.appendIndex(a),
      storage.appendIndex(b),
      storage.appendIndex(c),
    ]);
    const idx = await storage.readIndex();
    const ids = idx.map((r) => r.id).sort();
    expect(ids).toEqual([a.id, b.id, c.id].sort());
    const indexFile = path.resolve(workDir, "index.json");
    const raw = await readFile(indexFile, "utf8");
    expect(JSON.parse(raw)).toBeInstanceOf(Array);
  });

  it("appendIndex deduplicates by id (newest wins)", async () => {
    const id = idAt(7);
    await storage.appendIndex(summary(id, "2026-05-02T10:00:00.000Z", "running"));
    await storage.appendIndex(summary(id, "2026-05-02T10:00:00.000Z", "done"));
    const idx = await storage.readIndex();
    expect(idx.filter((r) => r.id === id)).toHaveLength(1);
    expect(idx[0]?.status).toBe("done");
  });

  it("pruneToCap drops oldest entries past the cap and removes their files", async () => {
    for (let i = 0; i < 60; i++) {
      const ts = new Date(Date.UTC(2026, 4, 2, 10, 0, i)).toISOString();
      await storage.appendIndex(summary(idAt(i), ts));
      await writeFile(storage.recordingFilePath(idAt(i)), "x");
    }
    await storage.pruneToCap(50);
    const idx = await storage.readIndex();
    expect(idx).toHaveLength(50);
    // The oldest 10 (by startedAt) must be gone from disk.
    const { existsSync } = await import("node:fs");
    expect(existsSync(storage.recordingFilePath(idAt(0)))).toBe(false);
    expect(existsSync(storage.recordingFilePath(idAt(59)))).toBe(true);
  });

  it("readIndex recovers from a corrupt index by returning []", async () => {
    await mkdir(workDir, { recursive: true });
    await writeFile(path.resolve(workDir, "index.json"), "{not json", "utf8");
    expect(await storage.readIndex()).toEqual([]);
  });

  it("appendEventLog + readEventLog round-trip", async () => {
    const id = idAt(11);
    const e1: RecordingProgressEvent = {
      ts: "2026-05-02T10:00:00.000Z",
      category: "recording",
      severity: "info",
      title: "Recording starting",
    };
    const e2: RecordingProgressEvent = {
      ts: "2026-05-02T10:00:01.000Z",
      category: "scenario",
      severity: "info",
      title: "Phase: cruise",
    };
    await storage.appendEventLog(id, e1);
    await storage.appendEventLog(id, e2);
    const out = await storage.readEventLog(id);
    expect(out).toEqual([e1, e2]);
  });

  it("readEventLog skips a torn last line", async () => {
    const id = idAt(12);
    const file = storage.eventLogPath(id);
    const valid: RecordingProgressEvent = {
      ts: "2026-05-02T10:00:00.000Z",
      category: "recording",
      severity: "info",
      title: "ok",
    };
    await writeFile(file, `${JSON.stringify(valid)}\n{this is`, "utf8");
    const out = await storage.readEventLog(id);
    expect(out).toEqual([valid]);
  });

  it("statRecording returns null when the file is missing", async () => {
    const id = idAt(13);
    expect(await storage.statRecording(id)).toBeNull();
    await writeFile(storage.recordingFilePath(id), "0123456789");
    expect(await storage.statRecording(id)).toEqual({ sizeBytes: 10 });
  });
});

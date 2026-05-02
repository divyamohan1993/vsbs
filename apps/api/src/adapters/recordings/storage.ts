// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
//
// Disk-backed storage for recording artefacts:
//   <root>/<id>.mp4              composite video (final)
//   <root>/<id>.poster.jpg       3-up poster (lazy)
//   <root>/<id>.events.jsonl     append-only progress log
//   <root>/index.json            array of last 50 RecordingSummary objects
//
// Every produced path is resolved through pathInside() which rejects any
// id that escapes the storage root via "..", "/", or NUL. Index writes are
// atomic (tmp + fsync + rename) and serialised through a process-level
// promise queue, so two concurrent updates never clobber each other.

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { open } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  type RecordingProgressEvent,
  RecordingProgressEventSchema,
  type RecordingSummary,
  RecordingSummarySchema,
} from "./types.js";

const INDEX_CAP = 50;

export interface StorageRootOptions {
  root?: string;
}

export class RecordingsStorage {
  readonly root: string;
  private indexLock: Promise<void> = Promise.resolve();

  constructor(opts: StorageRootOptions = {}) {
    this.root = path.resolve(opts.root ?? path.resolve(process.cwd(), "var/recordings"));
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  recordingFilePath(id: string): string {
    return this.pathInside(`${this.requireId(id)}.mp4`);
  }
  posterFilePath(id: string): string {
    return this.pathInside(`${this.requireId(id)}.poster.jpg`);
  }
  eventLogPath(id: string): string {
    return this.pathInside(`${this.requireId(id)}.events.jsonl`);
  }

  private requireId(id: string): string {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("recording id is empty");
    }
    if (id.includes("/") || id.includes("\\") || id.includes("..") || id.includes("\0")) {
      throw new Error(`recording id has illegal characters: ${JSON.stringify(id)}`);
    }
    return id;
  }

  /** Resolve a leaf name inside the storage root. Throws on traversal. */
  pathInside(leaf: string): string {
    if (typeof leaf !== "string" || leaf.length === 0 || leaf.includes("\0")) {
      throw new Error(`invalid recording leaf: ${JSON.stringify(leaf)}`);
    }
    if (leaf.includes("/") || leaf.includes("\\") || leaf.includes("..")) {
      throw new Error(`invalid recording leaf: ${JSON.stringify(leaf)}`);
    }
    const resolved = path.resolve(this.root, leaf);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!resolved.startsWith(rootWithSep) || resolved === this.root) {
      throw new Error(`path escapes storage root: ${leaf}`);
    }
    return resolved;
  }

  async readIndex(): Promise<RecordingSummary[]> {
    const file = path.resolve(this.root, "index.json");
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      // Other I/O errors are not recoverable here; bubble up.
      throw err;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: RecordingSummary[] = [];
      for (const row of parsed) {
        const r = RecordingSummarySchema.safeParse(row);
        if (r.success) out.push(r.data);
      }
      return out;
    } catch {
      // Corrupt index — reset to empty so we self-heal. The next append
      // will rewrite the file atomically.
      return [];
    }
  }

  /** Single-instance mutex around index updates. */
  private withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.indexLock;
    let release!: () => void;
    this.indexLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    return prev.then(fn).finally(() => release());
  }

  async appendIndex(summary: RecordingSummary): Promise<void> {
    await this.withIndexLock(async () => {
      const cur = await this.readIndex();
      const next = [summary, ...cur.filter((r) => r.id !== summary.id)];
      await this.writeIndexAtomic(next.slice(0, INDEX_CAP));
      await this.pruneFiles(next.slice(0, INDEX_CAP));
    });
  }

  async pruneToCap(cap = INDEX_CAP): Promise<void> {
    await this.withIndexLock(async () => {
      const cur = await this.readIndex();
      const sorted = [...cur].sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
      );
      const kept = sorted.slice(0, cap);
      if (kept.length !== sorted.length) {
        await this.writeIndexAtomic(kept);
      }
      await this.pruneFiles(kept);
    });
  }

  private async writeIndexAtomic(rows: RecordingSummary[]): Promise<void> {
    await this.ensureDir();
    const final = path.resolve(this.root, "index.json");
    const tmp = path.resolve(
      this.root,
      `index.json.${randomBytes(6).toString("hex")}.tmp`,
    );
    const data = JSON.stringify(rows, null, 2);
    const fh = await open(tmp, "w");
    try {
      await fh.writeFile(data, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, final);
  }

  /** Remove on-disk artefacts for any id NOT in the current index. */
  private async pruneFiles(kept: RecordingSummary[]): Promise<void> {
    const keepIds = new Set(kept.map((r) => r.id));
    let entries: string[];
    try {
      const { readdir } = await import("node:fs/promises");
      entries = await readdir(this.root);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "index.json") continue;
      if (name.endsWith(".tmp")) {
        await safeRm(path.resolve(this.root, name));
        continue;
      }
      const m = name.match(/^([0-9a-f-]{36})\.(mp4|poster\.jpg|events\.jsonl|dashboard\.mp4|carla\.mp4)$/i);
      if (!m) continue;
      const id = m[1]!;
      if (!keepIds.has(id)) {
        await safeRm(path.resolve(this.root, name));
      }
    }
  }

  async appendEventLog(id: string, event: RecordingProgressEvent): Promise<void> {
    await this.ensureDir();
    const line = `${JSON.stringify(event)}\n`;
    const file = this.eventLogPath(id);
    const fh = await open(file, "a");
    try {
      await fh.writeFile(line, "utf8");
    } finally {
      await fh.close();
    }
  }

  async readEventLog(id: string): Promise<RecordingProgressEvent[]> {
    const file = this.eventLogPath(id);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: RecordingProgressEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      try {
        const parsed = RecordingProgressEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // skip malformed line — append-only log can have a torn last line
      }
    }
    return out;
  }

  async statRecording(id: string): Promise<{ sizeBytes: number } | null> {
    try {
      const s = await stat(this.recordingFilePath(id));
      return { sizeBytes: s.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

async function safeRm(p: string): Promise<void> {
  try {
    await rm(p, { force: true });
  } catch {
    // best effort
  }
}

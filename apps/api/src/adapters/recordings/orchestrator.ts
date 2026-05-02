// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
//
// Demo-recording orchestrator. Owns one child process at a time, parses
// JSON_PROGRESS lines off stdout, fans them into the RecordingsHub, persists
// a sidecar event log, and (on success) appends the produced mp4 into the
// disk index.
//
// Single-instance state machine. start() throws RECORDING_BUSY while a
// child is running. Hard timeout = durationS + 120 s; the SIGINT/SIGKILL
// pair guarantees the child cannot outlive its budget.

import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type RecordingDownloadEvent,
  RecordingDownloadEventSchema,
  type RecordingProgressEvent,
  RecordingProgressEventSchema,
  type RecordingStartBody,
  type RecordingSummary,
  RecordingSummarySchema,
} from "./types.js";
import { type RecordingsHub, getRecordingsHub } from "./recordings-hub.js";
import { RecordingsStorage } from "./storage.js";

const ENV_WHITELIST = [
  "PATH",
  "DISPLAY",
  "LD_LIBRARY_PATH",
  "CARLA_ROOT",
  "HOME",
  "LANG",
  "LC_ALL",
  "XAUTHORITY",
] as const;

/**
 * Subset of Bun.Subprocess that the orchestrator depends on. Tests inject
 * a fake spawn that returns this same shape so we can drive the parser
 * without launching a real shell.
 */
export interface SpawnedProcess {
  pid?: number | undefined;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: (signal?: number | string) => void;
}

export interface SpawnOptions {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
}

export type SpawnFn = (opts: SpawnOptions) => SpawnedProcess;

const defaultSpawn: SpawnFn = (opts) => {
  const bun = (globalThis as unknown as {
    Bun?: {
      spawn: (init: {
        cmd: string[];
        cwd?: string;
        env?: Record<string, string>;
        stdout?: "pipe";
        stderr?: "pipe";
      }) => SpawnedProcess;
    };
  }).Bun;
  if (!bun || typeof bun.spawn !== "function") {
    throw new Error("Bun.spawn is unavailable; pass an explicit SpawnFn for tests");
  }
  return bun.spawn({
    cmd: opts.cmd,
    cwd: opts.cwd,
    env: opts.env,
    stdout: "pipe",
    stderr: "pipe",
  });
};

export interface OrchestratorOptions {
  hub?: RecordingsHub;
  storage?: RecordingsStorage;
  /** Path to record_demo.sh, resolved against repoRoot. */
  scriptPath?: string;
  /** Repo root — Bun.spawn cwd. */
  repoRoot?: string;
  /** API base URL injected into the child. */
  apiBase?: string;
  /** Override Bun.spawn — used in tests. */
  spawn?: SpawnFn;
  /** Override env source for the host process — used in tests. */
  hostEnv?: Record<string, string | undefined>;
  /** Hard-timeout multiplier for tests. */
  hardTimeoutMs?: (durationS: number) => number;
  /** Override new Date()/Date.now — used in tests. */
  now?: () => Date;
  /** Override id generator — used in tests. */
  idFactory?: () => string;
}

export interface StartResult {
  id: string;
  startedAt: string;
}

export class RecordingBusyError extends Error {
  readonly code = "RECORDING_BUSY";
  constructor(public readonly currentId: string) {
    super(`A recording is already running: ${currentId}`);
  }
}

interface ChildHandle {
  id: string;
  proc: SpawnedProcess;
  startedAt: number;
  durationS: number;
  outputPath: string;
  finished: boolean;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  killHandle: ReturnType<typeof setTimeout> | null;
}

export class RecordingOrchestrator {
  readonly hub: RecordingsHub;
  readonly storage: RecordingsStorage;
  readonly repoRoot: string;
  readonly scriptPath: string;
  readonly apiBase: string;
  private readonly spawn: SpawnFn;
  private readonly hostEnv: Record<string, string | undefined>;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly hardTimeoutMsFn: (durationS: number) => number;

  private current: ChildHandle | null = null;

  constructor(opts: OrchestratorOptions = {}) {
    this.hub = opts.hub ?? getRecordingsHub();
    this.storage = opts.storage ?? new RecordingsStorage();
    this.repoRoot = opts.repoRoot ?? path.resolve(process.cwd(), "../..");
    this.scriptPath =
      opts.scriptPath ??
      path.resolve(this.repoRoot, "tools/carla/scripts/record_demo.sh");
    this.apiBase = opts.apiBase ?? "http://localhost:8787";
    this.spawn = opts.spawn ?? defaultSpawn;
    this.hostEnv = opts.hostEnv ?? (process.env as Record<string, string | undefined>);
    this.now = opts.now ?? (() => new Date());
    this.idFactory = opts.idFactory ?? (() => randomUUID());
    this.hardTimeoutMsFn =
      opts.hardTimeoutMs ?? ((durationS) => (durationS + 120) * 1_000);
  }

  getCurrent(): RecordingSummary | null {
    if (!this.current) return null;
    return this.hub.getSummary(this.current.id);
  }

  async list(): Promise<RecordingSummary[]> {
    return this.storage.readIndex();
  }

  async start(body: RecordingStartBody): Promise<StartResult> {
    if (this.current && !this.current.finished) {
      throw new RecordingBusyError(this.current.id);
    }
    await this.storage.ensureDir();

    const id = this.idFactory();
    const startedAt = this.now().toISOString();
    const outputPath = this.storage.recordingFilePath(id);

    const summary: RecordingSummary = RecordingSummarySchema.parse({
      id,
      startedAt,
      durationS: body.durationS,
      useCarlaIfAvailable: body.useCarlaIfAvailable,
      ...(body.label !== undefined ? { label: body.label } : {}),
      status: "running",
    });
    this.hub.setSummary(id, summary);

    const env = this.buildEnv({
      RECORDING_ID: id,
      RECORDING_DURATION_S: String(body.durationS),
      RECORDING_USE_CARLA: body.useCarlaIfAvailable ? "true" : "false",
      RECORDING_OUTPUT_PATH: outputPath,
      VSBS_API_BASE: this.apiBase,
    });

    let proc: SpawnedProcess;
    try {
      proc = this.spawn({
        cmd: ["bash", this.scriptPath],
        cwd: this.repoRoot,
        env,
      });
    } catch (err) {
      const failure = this.synthesise({
        category: "done",
        severity: "alert",
        title: "spawn-failed",
        detail: String(err),
      });
      this.hub.publishProgress(id, failure);
      const finalSummary: RecordingSummary = {
        ...summary,
        status: "error",
        completedAt: this.now().toISOString(),
        errorMessage: String(err),
      };
      this.hub.setSummary(id, finalSummary);
      await this.storage.appendIndex(finalSummary);
      throw err;
    }

    const handle: ChildHandle = {
      id,
      proc,
      startedAt: Date.now(),
      durationS: body.durationS,
      outputPath,
      finished: false,
      timeoutHandle: null,
      killHandle: null,
    };
    this.current = handle;

    this.publish(id, {
      category: "recording",
      severity: "info",
      title: "Recording starting",
      detail: `id=${id} duration=${body.durationS}s carla=${body.useCarlaIfAvailable}`,
    });

    handle.timeoutHandle = setTimeout(() => {
      this.handleTimeout(handle).catch(() => {
        /* logged via hub */
      });
    }, this.hardTimeoutMsFn(body.durationS));

    void this.runChild(handle, body, summary);

    return { id, startedAt };
  }

  cancel(): boolean {
    if (!this.current || this.current.finished) return false;
    try {
      this.current.proc.kill("SIGINT");
    } catch {
      /* ignore */
    }
    return true;
  }

  private buildEnv(extra: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of ENV_WHITELIST) {
      const v = this.hostEnv[k];
      if (typeof v === "string") out[k] = v;
    }
    Object.assign(out, extra);
    return out;
  }

  private synthesise(
    e: Pick<RecordingProgressEvent, "category" | "severity" | "title"> &
      Partial<Pick<RecordingProgressEvent, "detail" | "data">>,
  ): RecordingProgressEvent {
    return {
      ts: this.now().toISOString(),
      category: e.category,
      severity: e.severity,
      title: e.title,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
      ...(e.data !== undefined ? { data: e.data } : {}),
    };
  }

  private publish(id: string, partial: Pick<
    RecordingProgressEvent,
    "category" | "severity" | "title"
  > &
    Partial<Pick<RecordingProgressEvent, "detail" | "data">>): void {
    const event = this.synthesise(partial);
    this.hub.publishProgress(id, event);
    void this.storage.appendEventLog(id, event).catch(() => {
      /* sink fail is non-fatal */
    });
  }

  private publishParsed(id: string, event: RecordingProgressEvent): void {
    this.hub.publishProgress(id, event);
    void this.storage.appendEventLog(id, event).catch(() => {
      /* sink fail is non-fatal */
    });
  }

  private async runChild(
    handle: ChildHandle,
    body: RecordingStartBody,
    seedSummary: RecordingSummary,
  ): Promise<void> {
    const stdoutDone = handle.proc.stdout
      ? this.consumeStdout(handle).catch((err) => {
          this.publish(handle.id, {
            category: "recording",
            severity: "watch",
            title: "stdout-reader-failed",
            detail: String(err),
          });
        })
      : Promise.resolve();
    const stderrDone = handle.proc.stderr
      ? this.consumeStderr(handle).catch(() => {
          /* logged inline */
        })
      : Promise.resolve();

    let exitCode = 0;
    try {
      exitCode = await handle.proc.exited;
    } catch (err) {
      this.publish(handle.id, {
        category: "recording",
        severity: "alert",
        title: "child-await-failed",
        detail: String(err),
      });
    }
    await Promise.allSettled([stdoutDone, stderrDone]);

    if (handle.timeoutHandle) clearTimeout(handle.timeoutHandle);
    if (handle.killHandle) clearTimeout(handle.killHandle);

    handle.finished = true;
    try {
      await this.finalise(handle, body, seedSummary, exitCode);
    } finally {
      if (this.current === handle) this.current = null;
    }
  }

  private async consumeStdout(handle: ChildHandle): Promise<void> {
    const reader = handle.proc.stdout!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          this.handleStdoutLine(handle.id, line);
          nl = buf.indexOf("\n");
        }
      }
      if (buf.length > 0) this.handleStdoutLine(handle.id, buf);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  private handleStdoutLine(id: string, raw: string): void {
    const line = raw.trim();
    if (line.length === 0) return;
    if (!line.startsWith("JSON_PROGRESS ")) {
      // non-progress stdout — useful for diagnostics but kept out of the
      // structured stream. Rate-limit by capping the surfaced line length.
      this.publish(id, {
        category: "recording",
        severity: "info",
        title: "stdout",
        detail: line.slice(0, 200),
      });
      return;
    }
    const payload = line.slice("JSON_PROGRESS ".length);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload);
    } catch (err) {
      this.publish(id, {
        category: "recording",
        severity: "watch",
        title: "json-parse-failed",
        detail: `${String(err).slice(0, 80)} :: ${payload.slice(0, 160)}`,
      });
      return;
    }
    const withTs =
      parsedJson && typeof parsedJson === "object" && !("ts" in parsedJson)
        ? { ts: this.now().toISOString(), ...(parsedJson as Record<string, unknown>) }
        : parsedJson;
    const result = RecordingProgressEventSchema.safeParse(withTs);
    if (!result.success) {
      this.publish(id, {
        category: "recording",
        severity: "watch",
        title: "schema-mismatch",
        detail: payload.slice(0, 200),
      });
      return;
    }
    this.publishParsed(id, result.data);
  }

  private async consumeStderr(handle: ChildHandle): Promise<void> {
    const reader = handle.proc.stderr!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.trim().length > 0) {
            this.publish(handle.id, {
              category: "recording",
              severity: "watch",
              title: "stderr",
              detail: line.slice(0, 200),
            });
          }
          nl = buf.indexOf("\n");
        }
      }
      if (buf.trim().length > 0) {
        this.publish(handle.id, {
          category: "recording",
          severity: "watch",
          title: "stderr",
          detail: buf.slice(0, 200),
        });
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  private async handleTimeout(handle: ChildHandle): Promise<void> {
    if (handle.finished) return;
    this.publish(handle.id, {
      category: "done",
      severity: "alert",
      title: "timeout",
      detail: `wall-clock budget of ${this.hardTimeoutMsFn(handle.durationS)}ms exhausted`,
    });
    try {
      handle.proc.kill("SIGINT");
    } catch {
      /* ignore */
    }
    handle.killHandle = setTimeout(() => {
      try {
        handle.proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 5_000);
  }

  private async finalise(
    handle: ChildHandle,
    body: RecordingStartBody,
    seedSummary: RecordingSummary,
    exitCode: number,
  ): Promise<void> {
    const stat = await this.storage.statRecording(handle.id);
    const events = this.hub.recentProgress(handle.id);
    const last = events[events.length - 1];
    const completedAt = this.now().toISOString();

    const sizeBytes = stat?.sizeBytes ?? 0;
    const encoder =
      pickEncoderFromEvents(events) ?? (sizeBytes === 0 ? undefined : "synthetic");
    const wallS = Math.max(0, Math.round((Date.now() - handle.startedAt) / 1_000));

    const errored =
      exitCode !== 0 ||
      sizeBytes === 0 ||
      (last?.severity === "alert" && last.category === "done");

    const finalSummary: RecordingSummary = {
      ...seedSummary,
      status: errored ? "error" : "done",
      ...(encoder ? { encoder } : {}),
      ...(stat ? { sizeBytes: stat.sizeBytes } : {}),
      completedAt,
      ...(errored
        ? {
            errorMessage:
              last && last.title === "timeout"
                ? "timeout"
                : `exit=${exitCode}`,
          }
        : {}),
    };

    this.hub.setSummary(handle.id, finalSummary);

    // Persist last known summary into the disk index regardless of outcome.
    try {
      await this.storage.appendIndex(finalSummary);
    } catch {
      /* index failure is logged below */
    }

    if (!errored && stat && encoder) {
      const download: RecordingDownloadEvent = RecordingDownloadEventSchema.parse({
        url: `/v1/recordings/${handle.id}/file`,
        posterUrl: `/v1/recordings/${handle.id}/poster.jpg`,
        sizeBytes: stat.sizeBytes,
        durationS: body.durationS,
        encoder,
      });
      this.hub.publishDownload(handle.id, download);
      this.publish(handle.id, {
        category: "done",
        severity: "info",
        title: "Recording done",
        detail: `${stat.sizeBytes}B (${encoder}) wall=${wallS}s`,
        data: {
          path: handle.outputPath,
          sizeBytes: stat.sizeBytes,
          durationS: body.durationS,
          wallS,
          encoder,
        },
      });
    }
  }
}

function pickEncoderFromEvents(events: RecordingProgressEvent[]):
  | "hevc_nvenc"
  | "h264_nvenc"
  | "libx264"
  | "libx265"
  | "synthetic"
  | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (
      e.category === "encoding" &&
      (e.title.toLowerCase().includes("composite complete") ||
        e.title.toLowerCase().includes("composite-complete"))
    ) {
      const enc = (e.data?.["encoder"] as string | undefined) ?? undefined;
      if (
        enc === "hevc_nvenc" ||
        enc === "h264_nvenc" ||
        enc === "libx264" ||
        enc === "libx265" ||
        enc === "synthetic"
      ) {
        return enc;
      }
    }
  }
  return undefined;
}

let singleton: RecordingOrchestrator | null = null;
export function getOrchestrator(opts: OrchestratorOptions = {}): RecordingOrchestrator {
  if (!singleton) singleton = new RecordingOrchestrator(opts);
  return singleton;
}

export function resetOrchestratorForTests(): void {
  singleton = null;
}

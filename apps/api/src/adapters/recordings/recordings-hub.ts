// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
//
// RecordingsHub — in-memory pub/sub keyed by recording id.
//
// Two channels per recording:
//   - progress:  every JSON_PROGRESS line emitted by record_demo.sh, plus
//                synthetic envelopes the orchestrator generates when stderr
//                or hard-timeouts trigger. Replayed to late subscribers from
//                a 200-event ring buffer.
//   - download:  a single terminal envelope that names the produced file,
//                size, duration, and encoder. Sent by the orchestrator after
//                the encoded mp4 is fsynced and the index updated.
//
// The hub also tracks the current RecordingSummary so HTTP GET /:id can
// answer in O(1) without re-reading the disk index. Mirrors the contract
// of LiveAutonomyHub so the dashboard SSE pattern stays consistent.

import type {
  RecordingDownloadEvent,
  RecordingProgressEvent,
  RecordingSummary,
} from "./types.js";

interface RecordingChannel {
  events: RecordingProgressEvent[];
  summary: RecordingSummary | null;
  download: RecordingDownloadEvent | null;
  progressSubscribers: Set<(e: RecordingProgressEvent) => void>;
  downloadSubscribers: Set<(d: RecordingDownloadEvent) => void>;
}

const PROGRESS_RING = 200;

export class RecordingsHub {
  private channels = new Map<string, RecordingChannel>();

  private channel(id: string): RecordingChannel {
    let ch = this.channels.get(id);
    if (!ch) {
      ch = {
        events: [],
        summary: null,
        download: null,
        progressSubscribers: new Set(),
        downloadSubscribers: new Set(),
      };
      this.channels.set(id, ch);
    }
    return ch;
  }

  publishProgress(id: string, event: RecordingProgressEvent): void {
    const ch = this.channel(id);
    ch.events.push(event);
    if (ch.events.length > PROGRESS_RING) {
      ch.events.splice(0, ch.events.length - PROGRESS_RING);
    }
    for (const cb of ch.progressSubscribers) {
      try {
        cb(event);
      } catch {
        // a single broken subscriber must not stop the fan-out
      }
    }
  }

  publishDownload(id: string, event: RecordingDownloadEvent): void {
    const ch = this.channel(id);
    ch.download = event;
    for (const cb of ch.downloadSubscribers) {
      try {
        cb(event);
      } catch {
        // swallow
      }
    }
  }

  recentProgress(id: string): RecordingProgressEvent[] {
    return this.channels.get(id)?.events ?? [];
  }

  latestDownload(id: string): RecordingDownloadEvent | null {
    return this.channels.get(id)?.download ?? null;
  }

  setSummary(id: string, summary: RecordingSummary): void {
    this.channel(id).summary = summary;
  }

  getSummary(id: string): RecordingSummary | null {
    return this.channels.get(id)?.summary ?? null;
  }

  subscribeProgress(
    id: string,
    cb: (e: RecordingProgressEvent) => void,
  ): () => void {
    const ch = this.channel(id);
    ch.progressSubscribers.add(cb);
    return () => ch.progressSubscribers.delete(cb);
  }

  subscribeDownload(
    id: string,
    cb: (e: RecordingDownloadEvent) => void,
  ): () => void {
    const ch = this.channel(id);
    ch.downloadSubscribers.add(cb);
    return () => ch.downloadSubscribers.delete(cb);
  }

  clear(id?: string): void {
    if (id === undefined) {
      this.channels.clear();
      return;
    }
    this.channels.delete(id);
  }
}

let singleton: RecordingsHub | null = null;
export function getRecordingsHub(): RecordingsHub {
  if (!singleton) singleton = new RecordingsHub();
  return singleton;
}

export function resetRecordingsHubForTests(): void {
  singleton = null;
}

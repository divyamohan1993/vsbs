// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { describe, expect, it } from "vitest";
import { RecordingsHub } from "./recordings-hub.js";
import type {
  RecordingDownloadEvent,
  RecordingProgressEvent,
  RecordingSummary,
} from "./types.js";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function progress(title: string, ts = "2026-05-02T12:00:00.000Z"): RecordingProgressEvent {
  return { ts, category: "scenario", severity: "info", title };
}

describe("RecordingsHub", () => {
  it("publishes progress to all live subscribers", () => {
    const hub = new RecordingsHub();
    const seenA: string[] = [];
    const seenB: string[] = [];
    hub.subscribeProgress(ID_A, (e) => seenA.push(e.title));
    hub.subscribeProgress(ID_A, (e) => seenB.push(e.title));
    hub.publishProgress(ID_A, progress("Phase: cruise"));
    expect(seenA).toEqual(["Phase: cruise"]);
    expect(seenB).toEqual(["Phase: cruise"]);
  });

  it("retains the last 200 progress events in the ring", () => {
    const hub = new RecordingsHub();
    for (let i = 0; i < 250; i++) {
      hub.publishProgress(ID_A, progress(`tick-${i}`));
    }
    const recent = hub.recentProgress(ID_A);
    expect(recent).toHaveLength(200);
    expect(recent[0]?.title).toBe("tick-50");
    expect(recent.at(-1)?.title).toBe("tick-249");
  });

  it("late subscribers can replay the cached events", () => {
    const hub = new RecordingsHub();
    hub.publishProgress(ID_A, progress("p1"));
    hub.publishProgress(ID_A, progress("p2"));
    hub.publishProgress(ID_A, progress("p3"));
    const replay = hub.recentProgress(ID_A).map((e) => e.title);
    expect(replay).toEqual(["p1", "p2", "p3"]);
  });

  it("isolates channels by id", () => {
    const hub = new RecordingsHub();
    const seenA: string[] = [];
    const seenB: string[] = [];
    hub.subscribeProgress(ID_A, (e) => seenA.push(e.title));
    hub.subscribeProgress(ID_B, (e) => seenB.push(e.title));
    hub.publishProgress(ID_A, progress("a-only"));
    hub.publishProgress(ID_B, progress("b-only"));
    expect(seenA).toEqual(["a-only"]);
    expect(seenB).toEqual(["b-only"]);
  });

  it("a thrown subscriber callback never blocks the fan-out", () => {
    const hub = new RecordingsHub();
    let downstream = 0;
    hub.subscribeProgress(ID_A, () => {
      throw new Error("boom");
    });
    hub.subscribeProgress(ID_A, () => {
      downstream += 1;
    });
    hub.publishProgress(ID_A, progress("x"));
    expect(downstream).toBe(1);
  });

  it("publishes the download envelope and exposes the latest", () => {
    const hub = new RecordingsHub();
    const envelope: RecordingDownloadEvent = {
      url: "/v1/recordings/x/file",
      posterUrl: "/v1/recordings/x/poster.jpg",
      sizeBytes: 1024,
      durationS: 60,
      encoder: "libx264",
    };
    let lastSeen: RecordingDownloadEvent | null = null;
    hub.subscribeDownload(ID_A, (e) => {
      lastSeen = e;
    });
    hub.publishDownload(ID_A, envelope);
    expect(lastSeen).toEqual(envelope);
    expect(hub.latestDownload(ID_A)).toEqual(envelope);
  });

  it("setSummary then getSummary round-trips", () => {
    const hub = new RecordingsHub();
    const summary: RecordingSummary = {
      id: ID_A,
      startedAt: "2026-05-02T12:00:00.000Z",
      durationS: 60,
      useCarlaIfAvailable: true,
      status: "running",
    };
    hub.setSummary(ID_A, summary);
    expect(hub.getSummary(ID_A)).toEqual(summary);
  });

  it("clear(id) removes only that channel; clear() drops everything", () => {
    const hub = new RecordingsHub();
    hub.publishProgress(ID_A, progress("a"));
    hub.publishProgress(ID_B, progress("b"));
    hub.clear(ID_A);
    expect(hub.recentProgress(ID_A)).toEqual([]);
    expect(hub.recentProgress(ID_B).length).toBe(1);
    hub.clear();
    expect(hub.recentProgress(ID_B)).toEqual([]);
  });

  it("unsubscribe stops further callbacks", () => {
    const hub = new RecordingsHub();
    let count = 0;
    const off = hub.subscribeProgress(ID_A, () => {
      count += 1;
    });
    hub.publishProgress(ID_A, progress("first"));
    off();
    hub.publishProgress(ID_A, progress("second"));
    expect(count).toBe(1);
  });
});

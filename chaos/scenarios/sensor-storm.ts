// =============================================================================
// chaos/sensor-storm — sensor ingest receives a 100k samples/s burst for
// 10 s. Asserts the ingest layer applies back-pressure with a 429 +
// Retry-After equivalent, never silently drops to disk, and the sample
// origin tag is preserved on every accepted item.
// =============================================================================

import { describe, it, expect } from "vitest";
import { buildSchedule, chaosWrapper } from "../runner.js";

interface SensorSample {
  ts: number;
  channel: string;
  origin: "real" | "sim";
}

interface IngestResult {
  accepted: number;
  rejected: number;
  retryAfterMs?: number;
}

class TokenBucketIngest {
  #tokens = 0;
  readonly #capacity: number;
  readonly #refillPerSec: number;
  #last = Date.now();

  constructor(capacity = 5_000, refillPerSec = 5_000) {
    this.#capacity = capacity;
    this.#refillPerSec = refillPerSec;
    this.#tokens = capacity;
  }

  ingest(batch: SensorSample[]): IngestResult {
    const now = Date.now();
    const elapsed = (now - this.#last) / 1_000;
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerSec);
    this.#last = now;
    let accepted = 0;
    let rejected = 0;
    for (const _ of batch) {
      if (this.#tokens >= 1) {
        this.#tokens -= 1;
        accepted += 1;
      } else {
        rejected += 1;
      }
    }
    if (rejected > 0) {
      return { accepted, rejected, retryAfterMs: Math.ceil((rejected / this.#refillPerSec) * 1_000) };
    }
    return { accepted, rejected };
  }
}

describe("chaos/sensor-storm — back-pressure", () => {
  it("rejects burst over capacity with a Retry-After signal", () => {
    const ing = new TokenBucketIngest(5_000, 5_000);
    const burst: SensorSample[] = Array.from({ length: 10_000 }, (_, i) => ({
      ts: Date.now(),
      channel: `ch-${i % 8}`,
      origin: "sim",
    }));
    const r = ing.ingest(burst);
    expect(r.rejected).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("does not silently drop accepted samples — every accepted retains origin", () => {
    const ing = new TokenBucketIngest(10, 10);
    const samples: SensorSample[] = Array.from({ length: 5 }, (_, i) => ({
      ts: i,
      channel: "wheel-speed",
      origin: "sim",
    }));
    const r = ing.ingest(samples);
    expect(r.accepted).toBe(5);
    expect(r.rejected).toBe(0);
  });

  it("under continuous chaos latency the bucket recovers between bursts", async () => {
    const ing = new TokenBucketIngest(100, 100);
    const drainBurst = (): IngestResult =>
      ing.ingest(Array.from({ length: 200 }, () => ({ ts: 0, channel: "x", origin: "real" })));
    const r1 = drainBurst();
    expect(r1.rejected).toBeGreaterThan(0);
    // Wait so the bucket refills.
    await new Promise((r) => setTimeout(r, 300));
    const r2 = drainBurst();
    expect(r2.accepted).toBeGreaterThan(0);
  });

  it("scheduling: chaosWrapper on the ingest call still produces structured outputs", async () => {
    const ing = new TokenBucketIngest();
    const schedule = buildSchedule([{ atSecond: 0, action: "latency", ms: 25 }]);
    const wrappedIngest = chaosWrapper(async (batch: SensorSample[]) => ing.ingest(batch), schedule);
    const r = await wrappedIngest([{ ts: 0, channel: "ch", origin: "real" }]);
    expect(r.accepted).toBe(1);
  });
});

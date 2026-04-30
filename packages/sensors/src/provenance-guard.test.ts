import { describe, it, expect } from "vitest";
import type { SensorSample } from "@vsbs/shared";
import {
  MemoryDecisionLogStore,
  ProvenanceGuardedStore,
  brandReal,
  brandSim,
  brandAny,
  summariseGuard,
  type AnyOriginRecord,
} from "./provenance-guard.js";
import { arbitrate } from "./fusion.js";

function s(origin: "real" | "sim", i: number): SensorSample {
  return {
    channel: "obd-pid",
    timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    origin,
    vehicleId: `veh-${i % 3}`,
    value: { pid: "0105", value: 80 + i },
    health: { selfTestOk: true, trust: 1 },
  };
}

describe("brand* helpers", () => {
  it("brandReal accepts only real", () => {
    expect(() => brandReal(s("sim", 1))).toThrow();
    expect(brandReal(s("real", 1)).origin).toBe("real");
  });
  it("brandSim accepts only sim", () => {
    expect(() => brandSim(s("real", 1))).toThrow();
    expect(brandSim(s("sim", 1)).origin).toBe("sim");
  });
  it("brandAny is total", () => {
    expect(brandAny(s("real", 0)).origin).toBe("real");
    expect(brandAny(s("sim", 0)).origin).toBe("sim");
  });
});

describe("ProvenanceGuardedStore on a real backing store", () => {
  it("accepts 100 real, refuses 100 sim, persists exactly 100", async () => {
    const inner = new MemoryDecisionLogStore("real");
    const guarded = new ProvenanceGuardedStore(inner);

    const mixed: AnyOriginRecord[] = [];
    for (let i = 0; i < 100; i++) mixed.push(brandAny(s("real", i)));
    for (let i = 0; i < 100; i++) mixed.push(brandAny(s("sim", i)));
    // Shuffle deterministically.
    for (let i = mixed.length - 1; i > 0; i--) {
      const j = (i * 7919) % (i + 1);
      const a = mixed[i]!;
      mixed[i] = mixed[j]!;
      mixed[j] = a;
    }

    const written = await guarded.append(mixed);
    expect(written).toBe(100);

    const rows = await guarded.list();
    expect(rows.length).toBe(100);
    for (const r of rows) expect(r.origin).toBe("real");

    expect(guarded.ledger).toEqual({
      acceptedReal: 100,
      acceptedSim: 0,
      rejectedSim: 100,
      rejectedReal: 0,
    });
  });
});

describe("ProvenanceGuardedStore on a sim backing store", () => {
  it("accepts both sim and real are *not* mixed: sim store accepts only sim", async () => {
    const inner = new MemoryDecisionLogStore("sim");
    const guarded = new ProvenanceGuardedStore(inner);

    const records: AnyOriginRecord[] = [];
    for (let i = 0; i < 25; i++) records.push(brandAny(s("sim", i)));
    for (let i = 0; i < 5; i++) records.push(brandAny(s("real", i)));

    const written = await guarded.append(records);
    expect(written).toBe(25);

    const rows = await guarded.list();
    for (const r of rows) expect(r.origin).toBe("sim");

    expect(guarded.ledger.acceptedSim).toBe(25);
    expect(guarded.ledger.rejectedReal).toBe(5);
    expect(guarded.ledger.rejectedSim).toBe(0);
  });
});

describe("summariseGuard", () => {
  it("attaches integrity counts to a FusedObservation without losing originSummary", () => {
    const obs = arbitrate("v1", [], [s("real", 0), s("sim", 1)]);
    const summarised = summariseGuard(obs, {
      acceptedReal: 1,
      acceptedSim: 0,
      rejectedSim: 1,
      rejectedReal: 0,
    });
    expect(summarised.observationId).toBe(obs.observationId);
    expect(summarised.originSummary.real).toBe(1);
    expect(summarised.integrity.rejectedSim).toBe(1);
  });
});

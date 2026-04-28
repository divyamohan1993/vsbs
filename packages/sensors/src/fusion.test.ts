import { describe, it, expect } from "vitest";
import { ScalarKalman, arbitrate, type Statement } from "./fusion.js";
import type { SensorSample } from "@vsbs/shared";

describe("ScalarKalman", () => {
  it("predict increases covariance", () => {
    const k = new ScalarKalman({ x0: 10, p0: 1, q: 0.5, r: 0.1 });
    const p0 = k.p;
    k.predict(2);
    expect(k.p).toBeGreaterThan(p0);
  });

  it("update shrinks covariance and moves estimate toward measurement", () => {
    const k = new ScalarKalman({ x0: 10, p0: 1, q: 0.1, r: 0.1 });
    const pBefore = k.p;
    k.update(12);
    expect(k.p).toBeLessThan(pBefore);
    expect(k.x).toBeGreaterThan(10);
    expect(k.x).toBeLessThan(12);
  });

  it("update returns innovation z - x", () => {
    const k = new ScalarKalman({ x0: 5, p0: 1, q: 0.1, r: 0.1 });
    const inn = k.update(8);
    expect(inn).toBeCloseTo(3, 10);
  });

  it("repeated updates converge to the measurement", () => {
    const k = new ScalarKalman({ x0: 0, p0: 1, q: 0.01, r: 0.1 });
    for (let i = 0; i < 200; i++) k.update(5);
    expect(k.x).toBeCloseTo(5, 1);
  });
});

describe("arbitrate", () => {
  const samples: SensorSample[] = [
    { channel: "obd-pid", timestamp: "2026-04-15T10:00:00.000Z", origin: "real", vehicleId: "v1", value: null, health: { selfTestOk: true, trust: 1 } },
    { channel: "tpms", timestamp: "2026-04-15T10:00:00.000Z", origin: "sim", vehicleId: "v1", value: null, health: { selfTestOk: true, trust: 1 } },
  ];

  it("confirmed when ≥2 supports > 0.5 trust and no contradiction", () => {
    const stmts: Statement[] = [{
      claim: "brake-wear-high",
      evidence: [
        { channel: "obd-pid", agrees: true, trust: 0.9 },
        { channel: "brake-pressure", agrees: true, trust: 0.8 },
      ],
    }];
    const out = arbitrate("v1", stmts, samples);
    expect(out.statements[0]!.status).toBe("confirmed");
    expect(out.statements[0]!.supportingChannels).toContain("obd-pid");
    expect(out.originSummary).toEqual({
      real: 1,
      sim: 1,
      simSources: { deterministic: 1, carla: 0, replay: 0 },
    });
  });

  it("suspected with a single support", () => {
    const stmts: Statement[] = [{
      claim: "tpms-low",
      evidence: [{ channel: "tpms", agrees: true, trust: 0.7 }],
    }];
    const out = arbitrate("v1", stmts, samples);
    expect(out.statements[0]!.status).toBe("suspected");
  });

  it("sensor-failure when no support and contradiction dominates", () => {
    const stmts: Statement[] = [{
      claim: "ghost-fault",
      evidence: [
        { channel: "obd-pid", agrees: false, trust: 0.9 },
        { channel: "radar-front", agrees: false, trust: 0.8 },
      ],
    }];
    const out = arbitrate("v1", stmts, samples);
    expect(out.statements[0]!.status).toBe("sensor-failure");
    expect(out.statements[0]!.supportingChannels.length).toBe(0);
  });

  it("records observation id and timestamp", () => {
    const out = arbitrate("v1", [], samples);
    expect(out.observationId).toMatch(/[0-9a-f-]{36}/i);
    expect(out.vehicleId).toBe("v1");
    expect(typeof out.timestamp).toBe("string");
  });

  it("counts simSource categories on origin summary", () => {
    const mixed: SensorSample[] = [
      { channel: "obd-pid", timestamp: "2026-04-15T10:00:00.000Z", origin: "real", vehicleId: "v1", value: null, health: { selfTestOk: true, trust: 1 } },
      { channel: "tpms", timestamp: "2026-04-15T10:00:00.000Z", origin: "sim", vehicleId: "v1", value: null, health: { selfTestOk: true, trust: 1 }, simSource: "carla" },
      { channel: "tpms", timestamp: "2026-04-15T10:00:01.000Z", origin: "sim", vehicleId: "v1", value: null, health: { selfTestOk: true, trust: 1 }, simSource: "carla" },
      { channel: "imu", timestamp: "2026-04-15T10:00:02.000Z", origin: "sim", vehicleId: "v1", value: null, health: { selfTestOk: true, trust: 1 }, simSource: "replay" },
      { channel: "bms", timestamp: "2026-04-15T10:00:03.000Z", origin: "sim", vehicleId: "v1", value: null, health: { selfTestOk: true, trust: 1 } },
    ];
    const out = arbitrate("v1", [], mixed);
    expect(out.originSummary).toEqual({
      real: 1,
      sim: 4,
      simSources: { deterministic: 1, carla: 2, replay: 1 },
    });
  });
});

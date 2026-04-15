// End-to-end sensor → Kalman → arbitration pipeline test. Wires a batch of
// simulator samples through a ScalarKalman and arbitrate() and asserts
// FusedObservation.originSummary stamps correctly.

import { describe, it, expect } from "vitest";
import type { SensorSample } from "@vsbs/shared";
import { ScalarKalman, arbitrate, type Statement } from "./fusion.js";
import { defaultVehicle, sampleAll } from "./simulator.js";

describe("sensor → Kalman → arbitrate pipeline", () => {
  it("preserves origin counts and arbitrates a multi-channel claim", () => {
    const v = defaultVehicle("veh-pipeline-1");
    v.state.brakePressureBar = 40;
    const batches: SensorSample[] = [];
    for (let k = 0; k < 5; k++) batches.push(...sampleAll(v));

    const brakeFilter = new ScalarKalman({ x0: 0, p0: 1, q: 0.5, r: 0.05 });
    const tpmsFilter = new ScalarKalman({ x0: 2.3, p0: 0.1, q: 0.01, r: 0.02 });
    for (const s of batches) {
      if (s.channel === "brake-pressure") {
        const v = (s.value as { bar: number }).bar;
        brakeFilter.predict(0.1);
        brakeFilter.update(v);
      } else if (s.channel === "tpms") {
        const v = (s.value as { bar: number }).bar;
        tpmsFilter.predict(0.1);
        tpmsFilter.update(v);
      }
    }
    expect(brakeFilter.x).toBeGreaterThan(30);
    expect(brakeFilter.x).toBeLessThan(50);

    const statements: Statement[] = [
      {
        claim: "brake-pedal-engaged",
        evidence: [
          { channel: "brake-pressure", agrees: brakeFilter.x > 5, trust: 0.95 },
          { channel: "obd-pid", agrees: true, trust: 0.7 },
        ],
      },
      {
        claim: "tyres-in-range",
        evidence: [{ channel: "tpms", agrees: tpmsFilter.x > 2.0, trust: 0.9 }],
      },
    ];
    const fused = arbitrate("veh-pipeline-1", statements, batches);
    expect(fused.vehicleId).toBe("veh-pipeline-1");
    // Every simulator sample is stamped origin=sim.
    expect(fused.originSummary.sim).toBe(batches.length);
    expect(fused.originSummary.real).toBe(0);
    expect(fused.statements[0]!.status).toBe("confirmed");
    expect(fused.statements[1]!.status).toBe("suspected");
  });

  it("mixed origin batch stamps the split", () => {
    const v = defaultVehicle("veh-pipeline-2");
    const sim = sampleAll(v);
    const now = new Date().toISOString();
    const real: SensorSample = {
      channel: "obd-pid",
      timestamp: now,
      origin: "real",
      vehicleId: "veh-pipeline-2",
      value: { pid: "0105", value: 86 },
      health: { selfTestOk: true, trust: 0.95 },
    };
    const all: SensorSample[] = [...sim, real];
    const fused = arbitrate("veh-pipeline-2", [], all);
    expect(fused.originSummary.real).toBe(1);
    expect(fused.originSummary.sim).toBe(sim.length);
  });
});

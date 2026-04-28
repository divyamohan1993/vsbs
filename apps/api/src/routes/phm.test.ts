import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { buildPhmRouter, draftBookingFromPhm, lookupPhmTrigger } from "./phm.js";
import { requestId, type AppEnv } from "../middleware/security.js";
import type { PhmReading } from "@vsbs/shared";

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.route("/v1/phm", buildPhmRouter());
  return app;
}

const brakeCriticalReading: PhmReading = {
  vehicleId: "veh-1",
  component: "brakes-pads-front",
  tier: 1,
  state: "critical",
  pFail1000km: 0.8,
  pFailLower: 0.7,
  pFailUpper: 0.9,
  rulKmMean: 60,
  rulKmLower: 30,
  modelSource: "physics-of-failure",
  featuresVersion: "v1",
  updatedAt: "2026-04-15T10:00:00.000Z",
  suspectedSensorFailure: false,
};

describe("phm routes", () => {
  it("evaluates phm action for a list of readings", async () => {
    const app = buildApp();
    const res = await app.request("/v1/phm/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readings: [brakeCriticalReading], inMotion: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.actions[0].component).toBe("brakes-pads-front");
    expect(body.data.actions[0].action.kind).toBe("takeover-required-and-block-autonomy");
  });

  it("drafts a booking from a critical PHM reading", async () => {
    const app = buildApp();
    const res = await app.request("/v1/phm/veh-1/triggers/booking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId: "veh-1",
        reading: brakeCriticalReading,
        inMotion: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.draft.requiredParts).toContain("BOSCH-BP1234");
    expect(body.data.draft.safety.severity).toBe("red");
    expect(body.data.draft.serviceSkill).toBe("brakes");
  });

  it("rejects a vehicleId mismatch between path and body", async () => {
    const app = buildApp();
    const res = await app.request("/v1/phm/wrong-id/triggers/booking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId: "veh-1",
        reading: brakeCriticalReading,
        inMotion: true,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("phm helpers", () => {
  it("lookupPhmTrigger returns specs for the demo failures", () => {
    expect(lookupPhmTrigger("brakes-pads-front")?.serviceSkill).toBe("brakes");
    expect(lookupPhmTrigger("battery-hv")?.requiredParts[0]).toBe("MERC-EQS-CELL-MOD-A1");
    expect(lookupPhmTrigger("airbag-srs")).toBeUndefined();
  });

  it("draftBookingFromPhm marks unsafe readings as red severity", () => {
    const unsafe: PhmReading = { ...brakeCriticalReading, state: "unsafe" };
    const { draft } = draftBookingFromPhm(unsafe);
    expect(draft.safety.severity).toBe("red");
    expect(draft.issue.canDriveSafely).toBe("no");
  });
});

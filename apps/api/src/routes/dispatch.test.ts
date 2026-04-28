import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { buildDispatchRouter, MemoryDispatchLegStore } from "./dispatch.js";
import { makeDemoInventory } from "../adapters/parts/inventory.js";
import { requestId, type AppEnv } from "../middleware/security.js";

function buildApp() {
  const inventory = makeDemoInventory();
  const legStore = new MemoryDispatchLegStore();
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.route("/v1/dispatch", buildDispatchRouter({ inventory, legStore }));
  return { app, legStore, inventory };
}

const BOOKING_ID = "0fd6f9c3-7d61-4d3e-9a3a-9f6c8dbf0001";

describe("dispatch routes", () => {
  it("shortlist filters by parts availability and explains the choice", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/dispatch/shortlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId: "veh-1",
        candidates: [
          { scId: "SC-IN-DEL-01", name: "Karol Bagh", wellbeing: 0.8, driveEtaMinutes: 12 },
          { scId: "SC-IN-DEL-02", name: "MFC", wellbeing: 0.95, driveEtaMinutes: 8 },
        ],
        requiredParts: ["TESLA-COOL-KIT-M3-2024"],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.partsRationale.chosen).toBe("SC-IN-DEL-01");
    expect(body.data.recommendation.scId).toBe("SC-IN-DEL-01");
  });

  it("shortlist returns 409 when no SC carries the parts", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/dispatch/shortlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId: "veh-2",
        candidates: [{ scId: "SC-IN-DEL-01", wellbeing: 0.9, driveEtaMinutes: 10 }],
        requiredParts: ["NO-SUCH-PART"],
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("NO_SC_HAS_PARTS");
  });

  it("leg state machine advances en-route -> at-sc -> servicing -> serviced -> returning -> closed", async () => {
    const { app } = buildApp();
    const start = await app.request(`/v1/dispatch/${BOOKING_ID}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scId: "SC-IN-DEL-01" }),
    });
    expect(start.status).toBe(201);

    const arrive = await app.request(`/v1/dispatch/${BOOKING_ID}/arrive`, { method: "POST" });
    expect(arrive.status).toBe(200);
    expect((await arrive.json()).data.leg).toBe("at-sc");

    const begin = await app.request(`/v1/dispatch/${BOOKING_ID}/begin-service`, { method: "POST" });
    expect((await begin.json()).data.leg).toBe("servicing");

    const complete = await app.request(`/v1/dispatch/${BOOKING_ID}/complete`, { method: "POST" });
    expect((await complete.json()).data.leg).toBe("serviced");

    const ret = await app.request(`/v1/dispatch/${BOOKING_ID}/return-leg`, { method: "POST" });
    expect((await ret.json()).data.leg).toBe("returning");

    const closed = await app.request(`/v1/dispatch/${BOOKING_ID}/returned`, { method: "POST" });
    expect((await closed.json()).data.leg).toBe("closed");
  });

  it("rejects illegal leg transitions with 409", async () => {
    const { app } = buildApp();
    await app.request(`/v1/dispatch/${BOOKING_ID}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scId: "SC-IN-DEL-01" }),
    });
    const skip = await app.request(`/v1/dispatch/${BOOKING_ID}/complete`, { method: "POST" });
    expect(skip.status).toBe(409);
  });

  it("commit endpoint accepts a full DispatchDecision payload", async () => {
    const { app } = buildApp();
    const decision = {
      id: "11111111-1111-4111-8111-111111111111",
      intakeId: "22222222-2222-4222-8222-222222222222",
      mode: "drive-in" as const,
      target: {
        kind: "service-center" as const,
        ref: {
          id: "SC-IN-DEL-01",
          name: "Karol Bagh",
          location: { lat: 28.65, lng: 77.19 },
          skills: ["brakes" as const],
          capacityPerHour: 8,
          currentLoadPerHour: 4,
          loanerAvailable: true,
          openWindows: [],
        },
        slot: {
          start: new Date().toISOString(),
          end: new Date(Date.now() + 3600_000).toISOString(),
        },
      },
      objectiveScore: 0.8,
      wellbeingScore: 0.85,
      estimatedTravelMinutes: 12,
      estimatedWaitMinutes: 5,
      estimatedRepairMinutes: 30,
      estimatedCostInrRange: [4500, 6000] as [number, number],
      explanation: ["picked because parts in stock"],
      alternatives: [],
      createdAt: new Date().toISOString(),
    };
    const res = await app.request("/v1/dispatch/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision),
    });
    expect(res.status).toBe(202);
  });
});

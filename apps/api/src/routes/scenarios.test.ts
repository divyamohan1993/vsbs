import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { InMemoryConsentManager, type ConsentManager } from "@vsbs/compliance";

import { buildScenariosRouter, DEMO_BOOTSTRAP_PURPOSES } from "./scenarios.js";
import { requestId, type AppEnv } from "../middleware/security.js";

function buildApp(opts: { consent?: ConsentManager } = {}) {
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.route("/v1/scenarios", buildScenariosRouter(opts));
  return app;
}

async function startScenario(app: Hono<AppEnv>) {
  const res = await app.request("/v1/scenarios/carla-demo/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vehicleId: "veh-carla-1", fault: "brake-pad-wear", scCount: 3 }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.data as { scenarioId: string; state: string; plannedSteps: string[] };
}

describe("scenarios routes", () => {
  it("starts a scenario with a planned-steps list", async () => {
    const app = buildApp();
    const scenario = await startScenario(app);
    expect(scenario.scenarioId).toMatch(/[0-9a-f-]{36}/);
    expect(scenario.state).toBe("IDLE");
    expect(scenario.plannedSteps[0]).toBe("DRIVING_HOME_AREA");
  });

  it("transitions through the orchestrator state machine and records history", async () => {
    const app = buildApp();
    const scenario = await startScenario(app);
    const states: string[] = [
      "DRIVING_HOME_AREA",
      "FAULT_INJECTING",
      "BOOKING_PENDING",
      "DRIVING_TO_SC",
      "DONE",
    ];
    for (const state of states) {
      const res = await app.request(`/v1/scenarios/${scenario.scenarioId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, note: `entered ${state}` }),
      });
      expect(res.status).toBe(200);
    }
    const final = await app.request(`/v1/scenarios/${scenario.scenarioId}`);
    const body = await final.json();
    expect(body.data.state).toBe("DONE");
    expect(body.data.history.length).toBeGreaterThanOrEqual(states.length);
  });

  it("records a manual fault injection as a history entry", async () => {
    const app = buildApp();
    const scenario = await startScenario(app);
    const res = await app.request(`/v1/scenarios/${scenario.scenarioId}/inject-fault`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fault: "coolant-overheat", note: "manual override" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.fault).toBe("coolant-overheat");
    expect(body.data.state).toBe("FAULT_INJECTING");
  });

  it("returns 404 when transitioning an unknown scenario", async () => {
    const app = buildApp();
    const res = await app.request(
      "/v1/scenarios/00000000-0000-4000-8000-000000000000/transition",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "DONE" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("lists active scenarios", async () => {
    const app = buildApp();
    await startScenario(app);
    await startScenario(app);
    const res = await app.request("/v1/scenarios");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scenarios.length).toBeGreaterThanOrEqual(2);
  });
});

describe("bootstrap-consent", () => {
  it("returns 503 when no ConsentManager is wired in", async () => {
    const app = buildApp();
    const res = await app.request("/v1/scenarios/bootstrap-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "demo-veh-1" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("CONSENT_MANAGER_UNAVAILABLE");
  });

  it("seeds the default demo purpose set when none specified", async () => {
    const consent = new InMemoryConsentManager();
    const app = buildApp({ consent });
    const res = await app.request("/v1/scenarios/bootstrap-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "demo-veh-1" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.userId).toBe("demo-veh-1");
    expect(body.data.purposes.length).toBe(DEMO_BOOTSTRAP_PURPOSES.length);
    for (const p of DEMO_BOOTSTRAP_PURPOSES) {
      expect(await consent.hasEffective("demo-veh-1", p)).toBe(true);
    }
  });

  it("clears the diagnostic-telemetry gate after bootstrap", async () => {
    const consent = new InMemoryConsentManager();
    const app = buildApp({ consent });
    const before = await consent.hasEffective("veh-2", "diagnostic-telemetry");
    expect(before).toBe(false);
    const res = await app.request("/v1/scenarios/bootstrap-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "veh-2" }),
    });
    expect(res.status).toBe(201);
    const after = await consent.hasEffective("veh-2", "diagnostic-telemetry");
    expect(after).toBe(true);
  });

  it("respects an explicit purposes list", async () => {
    const consent = new InMemoryConsentManager();
    const app = buildApp({ consent });
    const res = await app.request("/v1/scenarios/bootstrap-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "veh-3",
        purposes: ["diagnostic-telemetry"],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.purposes).toHaveLength(1);
    expect(await consent.hasEffective("veh-3", "diagnostic-telemetry")).toBe(true);
    // marketing is opt-in and was not in the request, so it stays ungranted.
    expect(await consent.hasEffective("veh-3", "marketing")).toBe(false);
  });

  it("rejects invalid purpose names with 400", async () => {
    const consent = new InMemoryConsentManager();
    const app = buildApp({ consent });
    const res = await app.request("/v1/scenarios/bootstrap-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "veh-4",
        purposes: ["not-a-real-purpose"],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("is idempotent — repeated calls keep the consent valid", async () => {
    const consent = new InMemoryConsentManager();
    const app = buildApp({ consent });
    const body = JSON.stringify({ userId: "veh-5" });
    const headers = { "content-type": "application/json" };
    const a = await app.request("/v1/scenarios/bootstrap-consent", { method: "POST", headers, body });
    const b = await app.request("/v1/scenarios/bootstrap-consent", { method: "POST", headers, body });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await consent.hasEffective("veh-5", "diagnostic-telemetry")).toBe(true);
  });
});

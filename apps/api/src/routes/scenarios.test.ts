import { type ConsentManager, InMemoryConsentManager } from "@vsbs/compliance";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { requestId } from "../middleware/security.js";
import { type SessionAppEnv, signSession } from "../middleware/session.js";
import { DEMO_BOOTSTRAP_PURPOSES, buildScenariosRouter } from "./scenarios.js";

const SIGN_KEY = "vsbs-test-session-signing-key-32-bytes-or-more-please";

async function bearer(subject: string): Promise<string> {
	const s = await signSession({ subject }, { signingKey: SIGN_KEY, defaultTtlSeconds: 3600 });
	return `Bearer ${s.token}`;
}

interface BuildAppOpts {
	consent?: ConsentManager;
	appEnv?: "development" | "test" | "production";
	demoMode?: boolean;
}

function buildApp(opts: BuildAppOpts = {}) {
	const app = new Hono<SessionAppEnv>();
	app.use("*", requestId());
	app.route(
		"/v1/scenarios",
		buildScenariosRouter({
			signingKey: SIGN_KEY,
			appEnv: opts.appEnv ?? "development",
			demoMode: opts.demoMode ?? true,
			...(opts.consent !== undefined ? { consent: opts.consent } : {}),
		}),
	);
	return app;
}

async function startScenario(app: Hono<SessionAppEnv>) {
	const res = await app.request("/v1/scenarios/carla-demo/start", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			vehicleId: "veh-carla-1",
			fault: "brake-pad-wear",
			scCount: 3,
		}),
	});
	expect(res.status).toBe(201);
	const body = await res.json();
	return body.data as {
		scenarioId: string;
		state: string;
		plannedSteps: string[];
	};
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
			body: JSON.stringify({
				fault: "coolant-overheat",
				note: "manual override",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.fault).toBe("coolant-overheat");
		expect(body.data.state).toBe("FAULT_INJECTING");
	});

	it("returns 404 when transitioning an unknown scenario", async () => {
		const app = buildApp();
		const res = await app.request("/v1/scenarios/00000000-0000-4000-8000-000000000000/transition", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ state: "DONE" }),
		});
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
	it("rejects requests without an Authorization bearer with 401 SESSION_REQUIRED", async () => {
		const app = buildApp({ consent: new InMemoryConsentManager() });
		const res = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("SESSION_REQUIRED");
	});

	it("returns 404 SCENARIO_NOT_AVAILABLE in production regardless of demoMode", async () => {
		const consent = new InMemoryConsentManager();
		const app = buildApp({ consent, appEnv: "production", demoMode: true });
		const res = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("demo-veh-1"),
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("SCENARIO_NOT_AVAILABLE");
	});

	it("returns 404 SCENARIO_NOT_AVAILABLE when demoMode is false", async () => {
		const consent = new InMemoryConsentManager();
		const app = buildApp({ consent, appEnv: "development", demoMode: false });
		const res = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("demo-veh-1"),
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("SCENARIO_NOT_AVAILABLE");
	});

	it("returns 503 when no ConsentManager is wired in", async () => {
		const app = buildApp();
		const res = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("demo-veh-1"),
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error.code).toBe("CONSENT_MANAGER_UNAVAILABLE");
	});

	it("seeds the default demo purpose set under the session subject", async () => {
		const consent = new InMemoryConsentManager();
		const app = buildApp({ consent });
		const res = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("demo-veh-1"),
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.data.userId).toBe("demo-veh-1");
		expect(body.data.purposes.length).toBe(DEMO_BOOTSTRAP_PURPOSES.length);
		for (const p of DEMO_BOOTSTRAP_PURPOSES) {
			expect(await consent.hasEffective("demo-veh-1", p)).toBe(true);
		}
	});

	it("ignores any client-supplied userId in the body — strict schema rejects unknown keys", async () => {
		const consent = new InMemoryConsentManager();
		const app = buildApp({ consent });
		const res = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("real-subject"),
			},
			body: JSON.stringify({ userId: "spoofed-subject" }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("VALIDATION_FAILED");
		// The spoofed subject must not have any consents recorded.
		expect(await consent.hasEffective("spoofed-subject", "diagnostic-telemetry")).toBe(false);
	});

	it("clears the diagnostic-telemetry gate after bootstrap", async () => {
		const consent = new InMemoryConsentManager();
		const app = buildApp({ consent });
		const before = await consent.hasEffective("veh-2", "diagnostic-telemetry");
		expect(before).toBe(false);
		const res = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("veh-2"),
			},
			body: JSON.stringify({}),
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
			headers: {
				"content-type": "application/json",
				authorization: await bearer("veh-3"),
			},
			body: JSON.stringify({
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
			headers: {
				"content-type": "application/json",
				authorization: await bearer("veh-4"),
			},
			body: JSON.stringify({
				purposes: ["not-a-real-purpose"],
			}),
		});
		expect(res.status).toBe(400);
	});

	it("is idempotent — repeated calls keep the consent valid", async () => {
		const consent = new InMemoryConsentManager();
		const app = buildApp({ consent });
		const auth = await bearer("veh-5");
		const body = JSON.stringify({});
		const headers = { "content-type": "application/json", authorization: auth };
		const a = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers,
			body,
		});
		const b = await app.request("/v1/scenarios/bootstrap-consent", {
			method: "POST",
			headers,
			body,
		});
		expect(a.status).toBe(201);
		expect(b.status).toBe(201);
		expect(await consent.hasEffective("veh-5", "diagnostic-telemetry")).toBe(true);
	});
});

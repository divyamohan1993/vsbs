import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
	DEFAULT_PURPOSE_REGISTRY,
	InMemoryConsentManager,
	buildEvidenceHash,
} from "@vsbs/compliance";

import { requireConsent } from "./consent-gate.js";
import { requestId } from "./security.js";
import { type SessionAppEnv, requireSession, signSession } from "./session.js";

const SIGN_KEY = "vsbs-test-session-signing-key-32-bytes-or-more-please";

async function bearer(subject: string): Promise<string> {
	const s = await signSession({ subject }, { signingKey: SIGN_KEY, defaultTtlSeconds: 3600 });
	return `Bearer ${s.token}`;
}

function buildApp(manager: InMemoryConsentManager) {
	const app = new Hono<SessionAppEnv>();
	app.use("*", requestId());
	app.use("/protected/*", requireSession({ signingKey: SIGN_KEY }));
	app.use("/protected/*", requireConsent("diagnostic-telemetry", { manager }));
	app.get("/protected/ok", (c) => c.json({ ok: true }));
	app.get("/open", (c) => c.json({ ok: true }));
	// Route that runs the gate WITHOUT requireSession — exercises the
	// OWNER_REQUIRED defensive 401.
	app.use("/raw-gate/*", requireConsent("diagnostic-telemetry", { manager }));
	app.get("/raw-gate/ok", (c) => c.json({ ok: true }));
	return app;
}

describe("requireConsent middleware", () => {
	it("returns 409 consent-required when the user has no record", async () => {
		const m = new InMemoryConsentManager();
		const app = buildApp(m);
		const res = await app.request("/protected/ok", {
			headers: { authorization: await bearer("user-no-consent") },
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as {
			error: { code: string; purpose: string; currentVersion: string };
		};
		expect(body.error.code).toBe("consent-required");
		expect(body.error.purpose).toBe("diagnostic-telemetry");
		expect(body.error.currentVersion).toBe("1.0.0");
	});

	it("allows the request when consent is recorded with the latest version", async () => {
		const m = new InMemoryConsentManager();
		const ev = await buildEvidenceHash(
			DEFAULT_PURPOSE_REGISTRY["diagnostic-telemetry"],
			"en",
			"We collect telemetry to diagnose faults.",
		);
		await m.record({
			userId: "user-with-consent",
			purpose: "diagnostic-telemetry",
			version: "1.0.0",
			evidenceHash: ev,
			source: "web",
		});
		const app = buildApp(m);
		const res = await app.request("/protected/ok", {
			headers: { authorization: await bearer("user-with-consent") },
		});
		expect(res.status).toBe(200);
	});

	it("returns 409 consent-stale when consent version is older than the notice", async () => {
		const m = new InMemoryConsentManager();
		const ev = await buildEvidenceHash(
			DEFAULT_PURPOSE_REGISTRY["diagnostic-telemetry"],
			"en",
			"Older notice.",
		);
		await m.record({
			userId: "user-stale",
			purpose: "diagnostic-telemetry",
			version: "0.9.0",
			evidenceHash: ev,
			source: "web",
		});
		const app = buildApp(m);
		const res = await app.request("/protected/ok", {
			headers: { authorization: await bearer("user-stale") },
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("consent-stale");
	});

	it("does not gate routes outside its scope", async () => {
		const m = new InMemoryConsentManager();
		const app = buildApp(m);
		const res = await app.request("/open");
		expect(res.status).toBe(200);
	});

	it("returns 401 OWNER_REQUIRED when reached without an authenticated session", async () => {
		const m = new InMemoryConsentManager();
		const app = buildApp(m);
		const res = await app.request("/raw-gate/ok");
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("OWNER_REQUIRED");
	});

	it("returns 401 SESSION_REQUIRED when no Authorization header is supplied to a session-protected route", async () => {
		const m = new InMemoryConsentManager();
		const app = buildApp(m);
		const res = await app.request("/protected/ok");
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_REQUIRED");
	});
});

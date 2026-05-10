import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { InMemoryConsentManager, buildSimErasureCoordinator } from "@vsbs/compliance";

import { requestId } from "../middleware/security.js";
import { type SessionAppEnv, signSession } from "../middleware/session.js";
import { buildMeRouter } from "./me.js";

const SIGN_KEY = "vsbs-test-session-signing-key-32-bytes-or-more-please";

async function bearer(subject: string, ttlSeconds = 3600): Promise<string> {
	const s = await signSession(
		{ subject, ttlSeconds },
		{ signingKey: SIGN_KEY, defaultTtlSeconds: 3600 },
	);
	return `Bearer ${s.token}`;
}

function buildApp() {
	const consent = new InMemoryConsentManager();
	const erasure = buildSimErasureCoordinator().coordinator;
	const app = new Hono<SessionAppEnv>();
	app.use("*", requestId());
	app.route("/v1/me", buildMeRouter({ signingKey: SIGN_KEY, consent, erasure }));
	return { app, consent, erasure };
}

describe("/v1/me routes", () => {
	it("rejects requests without a session bearer with 401 SESSION_REQUIRED", async () => {
		const { app } = buildApp();
		const res = await app.request("/v1/me/consent");
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_REQUIRED");
	});

	it("GET /consent returns the latest versions and current items", async () => {
		const { app } = buildApp();
		const res = await app.request("/v1/me/consent", {
			headers: { authorization: await bearer("u1") },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				ownerId: string;
				latestVersions: Record<string, string>;
				items: unknown[];
			};
		};
		expect(body.data.ownerId).toBe("u1");
		expect(body.data.latestVersions["diagnostic-telemetry"]).toBe("1.0.0");
	});

	it("scopes consent reads to the calling subject", async () => {
		const { app } = buildApp();
		// Subject A grants marketing.
		await app.request("/v1/me/consent/grant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("subject-a"),
			},
			body: JSON.stringify({
				purpose: "marketing",
				version: "1.0.0",
				source: "web",
			}),
		});
		// Subject B reads — must not see subject A's grant.
		const res = await app.request("/v1/me/consent", {
			headers: { authorization: await bearer("subject-b") },
		});
		const body = (await res.json()) as {
			data: {
				ownerId: string;
				items: Array<{ purpose: string; granted: boolean }>;
			};
		};
		expect(body.data.ownerId).toBe("subject-b");
		const m = body.data.items.find((x) => x.purpose === "marketing");
		expect(m?.granted ?? false).toBe(false);
	});

	it("POST /consent/grant records a row and the next GET shows it granted", async () => {
		const { app } = buildApp();
		const post = await app.request("/v1/me/consent/grant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("u2"),
			},
			body: JSON.stringify({
				purpose: "marketing",
				version: "1.0.0",
				source: "web",
			}),
		});
		expect(post.status).toBe(201);
		const get = await app.request("/v1/me/consent", {
			headers: { authorization: await bearer("u2") },
		});
		const body = (await get.json()) as {
			data: { items: Array<{ purpose: string; granted: boolean }> };
		};
		const m = body.data.items.find((x) => x.purpose === "marketing");
		expect(m?.granted).toBe(true);
	});

	it("POST /consent/grant rejects a stale version with 409", async () => {
		const { app } = buildApp();
		const res = await app.request("/v1/me/consent/grant", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("u3"),
			},
			body: JSON.stringify({
				purpose: "marketing",
				version: "0.9.0",
				source: "web",
			}),
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("CONSENT_VERSION_MISMATCH");
	});

	it("POST /consent/revoke refuses non-revocable purposes", async () => {
		const { app } = buildApp();
		const res = await app.request("/v1/me/consent/revoke", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("u4"),
			},
			body: JSON.stringify({ purpose: "service-fulfilment", reason: "no" }),
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("CONSENT_NOT_REVOCABLE");
	});

	it("POST /erasure with Idempotency-Key returns the same tombstone twice", async () => {
		const { app } = buildApp();
		const auth = await bearer("u5");
		const headers = {
			"content-type": "application/json",
			authorization: auth,
			"idempotency-key": "test-key-1",
		};
		const a = await app.request("/v1/me/erasure", {
			method: "POST",
			headers,
			body: JSON.stringify({ scope: "all" }),
		});
		const b = await app.request("/v1/me/erasure", {
			method: "POST",
			headers,
			body: JSON.stringify({ scope: "all" }),
		});
		expect(a.status).toBe(202);
		expect(b.status).toBe(202);
		const aj = (await a.json()) as { data: { tombstoneId: string } };
		const bj = (await b.json()) as { data: { tombstoneId: string } };
		expect(aj.data.tombstoneId).toBe(bj.data.tombstoneId);
	});

	it("GET /data-export bundles consents and erasure receipts", async () => {
		const { app } = buildApp();
		const auth = await bearer("u6");
		await app.request("/v1/me/consent/grant", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({
				purpose: "marketing",
				version: "1.0.0",
				source: "web",
			}),
		});
		const res = await app.request("/v1/me/data-export", {
			headers: { authorization: auth },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				ownerId: string;
				consents: Array<{ purpose: string }>;
				legalBasis: string;
			};
		};
		expect(body.data.ownerId).toBe("u6");
		expect(body.data.consents.some((r) => r.purpose === "marketing")).toBe(true);
		expect(body.data.legalBasis).toContain("DPDP");
	});

	it("returns 401 SESSION_EXPIRED for an expired bearer token", async () => {
		const { app } = buildApp();
		// Mint a token with a 1s TTL, then advance Date.now beyond it.
		const past = await signSession(
			{ subject: "expired-user" },
			{ signingKey: SIGN_KEY, defaultTtlSeconds: 1 },
		);
		// Force expiry by waiting just past the boundary. signSession uses
		// Math.floor(Date.now()/1000), so 1100ms guarantees the second-precision
		// exp has already passed.
		await new Promise((r) => setTimeout(r, 1_100));
		const res = await app.request("/v1/me/consent", {
			headers: { authorization: `Bearer ${past.token}` },
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_EXPIRED");
	});
});

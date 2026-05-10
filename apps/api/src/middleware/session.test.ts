import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { requestId } from "./security.js";
import {
	type SessionAppEnv,
	hmacSha256,
	optionalSession,
	requireSession,
	signSession,
	verifySession,
} from "./session.js";

const KEY = "test-session-signing-key-must-be-at-least-32-bytes-long";
const ALT_KEY = "different-test-session-signing-key-also-32-bytes-long-for-sure";

describe("signSession + verifySession", () => {
	it("round-trips and preserves subject", async () => {
		const signed = await signSession(
			{ subject: "user-42", ttlSeconds: 60 },
			{ signingKey: KEY, defaultTtlSeconds: 30 },
		);
		expect(signed.token.split(".")).toHaveLength(3);
		expect(typeof signed.expiresAt).toBe("string");

		const v = await verifySession(signed.token, { signingKey: KEY });
		expect(v.ok).toBe(true);
		if (v.ok) expect(v.subject).toBe("user-42");
	});

	it("rejects expired tokens with reason=expired", async () => {
		const signed = await signSession(
			{ subject: "user-9", ttlSeconds: 1 },
			{ signingKey: KEY, defaultTtlSeconds: 30 },
		);
		await new Promise((r) => setTimeout(r, 1100));
		const v = await verifySession(signed.token, { signingKey: KEY });
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toBe("expired");
	});

	it("rejects tampered payload with bad-signature", async () => {
		const signed = await signSession(
			{ subject: "user-7" },
			{ signingKey: KEY, defaultTtlSeconds: 30 },
		);
		const [h, p, s] = signed.token.split(".") as [string, string, string];
		const decoded = JSON.parse(globalThis.atob(p.replace(/-/g, "+").replace(/_/g, "/")));
		decoded.sub = "user-attacker";
		const forgedPayload = globalThis
			.btoa(JSON.stringify(decoded))
			.replace(/=+$/g, "")
			.replace(/\+/g, "-")
			.replace(/\//g, "_");
		const forged = `${h}.${forgedPayload}.${s}`;
		const v = await verifySession(forged, { signingKey: KEY });
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toBe("bad-signature");
	});

	it("rejects malformed token (only 2 segments)", async () => {
		const v = await verifySession("aaa.bbb", { signingKey: KEY });
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toBe("malformed");
	});

	it("rejects token signed with a different key as bad-signature", async () => {
		const signed = await signSession(
			{ subject: "user-x" },
			{ signingKey: ALT_KEY, defaultTtlSeconds: 30 },
		);
		const v = await verifySession(signed.token, { signingKey: KEY });
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toBe("bad-signature");
	});

	it("rejects empty string as missing", async () => {
		const v = await verifySession("", { signingKey: KEY });
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toBe("missing");
	});
});

describe("hmacSha256 primitive", () => {
	it("produces deterministic base64url HMAC for the same input", async () => {
		const a = await hmacSha256("k", "data");
		const b = await hmacSha256("k", "data");
		expect(a).toBe(b);
		expect(a).not.toContain("=");
		expect(a).not.toContain("/");
		expect(a).not.toContain("+");
	});
});

function buildApp(mode: "require" | "optional") {
	const app = new Hono<SessionAppEnv>();
	app.use("*", requestId());
	const mw =
		mode === "require" ? requireSession({ signingKey: KEY }) : optionalSession({ signingKey: KEY });
	app.use("*", mw);
	app.get("/p", (c) => c.json({ subject: c.get("ownerSubject") ?? null }));
	return app;
}

describe("requireSession middleware", () => {
	it("401 SESSION_REQUIRED when no Authorization header", async () => {
		const app = buildApp("require");
		const r = await app.request("/p");
		expect(r.status).toBe(401);
		const body = (await r.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_REQUIRED");
	});

	it("401 SESSION_INVALID for malformed bearer token", async () => {
		const app = buildApp("require");
		const r = await app.request("/p", {
			headers: { authorization: "Bearer not.a.jwt-shaped" },
		});
		expect(r.status).toBe(401);
		const body = (await r.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_INVALID");
	});

	it("401 SESSION_EXPIRED for expired token", async () => {
		const signed = await signSession(
			{ subject: "user-1", ttlSeconds: 1 },
			{ signingKey: KEY, defaultTtlSeconds: 30 },
		);
		await new Promise((r) => setTimeout(r, 1100));
		const app = buildApp("require");
		const r = await app.request("/p", {
			headers: { authorization: `Bearer ${signed.token}` },
		});
		expect(r.status).toBe(401);
		const body = (await r.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_EXPIRED");
	});

	it("calls next and sets ownerSubject for valid token", async () => {
		const signed = await signSession(
			{ subject: "user-ok" },
			{ signingKey: KEY, defaultTtlSeconds: 60 },
		);
		const app = buildApp("require");
		const r = await app.request("/p", {
			headers: { authorization: `Bearer ${signed.token}` },
		});
		expect(r.status).toBe(200);
		const body = (await r.json()) as { subject: string };
		expect(body.subject).toBe("user-ok");
	});
});

describe("optionalSession middleware", () => {
	it("passes through with no header and leaves subject unset", async () => {
		const app = buildApp("optional");
		const r = await app.request("/p");
		expect(r.status).toBe(200);
		const body = (await r.json()) as { subject: string | null };
		expect(body.subject).toBeNull();
	});

	it("populates subject with a valid token but does not reject invalid", async () => {
		const signed = await signSession(
			{ subject: "u-opt" },
			{ signingKey: KEY, defaultTtlSeconds: 60 },
		);
		const app = buildApp("optional");
		const ok = await app.request("/p", {
			headers: { authorization: `Bearer ${signed.token}` },
		});
		expect(ok.status).toBe(200);
		expect(((await ok.json()) as { subject: string }).subject).toBe("u-opt");

		const bad = await app.request("/p", {
			headers: { authorization: "Bearer junk.junk.junk" },
		});
		expect(bad.status).toBe(200);
		expect(((await bad.json()) as { subject: string | null }).subject).toBeNull();
	});
});

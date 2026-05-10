import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import {
	type AdminAppEnv,
	__clearJwksCacheForTest,
	__setJwksKeyForTest,
	adminOnly,
	signAdminDevToken,
} from "./admin.js";
import { requestId } from "./security.js";

const KEY = "vsbs-admin-test-signing-key-32-bytes-or-more-please";
const AUDIENCE = "/projects/123/global/backendServices/456";

function buildApp(opts: Parameters<typeof adminOnly>[0]) {
	const app = new Hono<AdminAppEnv>();
	app.use("*", requestId());
	app.use("*", adminOnly(opts));
	app.get("/p", (c) => c.json({ subject: c.get("adminSubject"), roles: c.get("adminRoles") }));
	return app;
}

afterEach(() => {
	__clearJwksCacheForTest();
});

// -----------------------------------------------------------------------------
// Sim mode
// -----------------------------------------------------------------------------
describe("adminOnly sim mode", () => {
	it("accepts a valid HMAC-signed dev token with admin role", async () => {
		const { token } = await signAdminDevToken(
			{ subject: "ops@vsbs.in", roles: ["admin"] },
			{ signingKey: KEY, defaultTtlSeconds: 300 },
		);
		const app = buildApp({
			mode: "sim",
			appEnv: "development",
			signingKey: KEY,
		});
		const r = await app.request("/p", {
			headers: { "x-vsbs-admin-token": token },
		});
		expect(r.status).toBe(200);
		const body = (await r.json()) as { subject: string; roles: string[] };
		expect(body.subject).toBe("ops@vsbs.in");
		expect(body.roles).toContain("admin");
	});

	it("rejects an old unsigned 3-part-base64 token with ADMIN_TOKEN_INVALID", async () => {
		const enc = (obj: unknown): string =>
			Buffer.from(JSON.stringify(obj), "utf-8")
				.toString("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/g, "");
		const header = enc({ alg: "none", typ: "JWT" });
		const payload = enc({
			sub: "attacker@vsbs.in",
			roles: ["admin"],
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const forged = `${header}.${payload}.dev-unsigned`;

		const app = buildApp({
			mode: "sim",
			appEnv: "development",
			signingKey: KEY,
		});
		const r = await app.request("/p", {
			headers: { "x-vsbs-admin-token": forged },
		});
		expect(r.status).toBe(401);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
			"ADMIN_TOKEN_INVALID",
		);
	});

	it("returns 401 ADMIN_REQUIRED when no admin header is present", async () => {
		const app = buildApp({
			mode: "sim",
			appEnv: "development",
			signingKey: KEY,
		});
		const r = await app.request("/p");
		expect(r.status).toBe(401);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe("ADMIN_REQUIRED");
	});

	it("returns 403 ADMIN_FORBIDDEN for token without admin role", async () => {
		const { token } = await signAdminDevToken(
			{ subject: "viewer", roles: ["viewer"] },
			{ signingKey: KEY, defaultTtlSeconds: 300 },
		);
		const app = buildApp({
			mode: "sim",
			appEnv: "development",
			signingKey: KEY,
		});
		const r = await app.request("/p", {
			headers: { "x-vsbs-admin-token": token },
		});
		expect(r.status).toBe(403);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe("ADMIN_FORBIDDEN");
	});

	it("returns 401 ADMIN_TOKEN_EXPIRED for expired dev token", async () => {
		const { token } = await signAdminDevToken(
			{ subject: "ops", roles: ["admin"], ttlSeconds: 1 },
			{ signingKey: KEY, defaultTtlSeconds: 1 },
		);
		await new Promise((r) => setTimeout(r, 1100));
		const app = buildApp({
			mode: "sim",
			appEnv: "development",
			signingKey: KEY,
		});
		const r = await app.request("/p", {
			headers: { "x-vsbs-admin-token": token },
		});
		expect(r.status).toBe(401);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
			"ADMIN_TOKEN_EXPIRED",
		);
	});

	it("returns 401 when token is signed with a different key", async () => {
		const { token } = await signAdminDevToken(
			{ subject: "ops", roles: ["admin"] },
			{
				signingKey: "different-key-also-32-chars-or-more-please",
				defaultTtlSeconds: 300,
			},
		);
		const app = buildApp({
			mode: "sim",
			appEnv: "development",
			signingKey: KEY,
		});
		const r = await app.request("/p", {
			headers: { "x-vsbs-admin-token": token },
		});
		expect(r.status).toBe(401);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
			"ADMIN_TOKEN_INVALID",
		);
	});

	it("returns 500 ADMIN_MISCONFIGURED if sim mode is invoked without a signingKey", async () => {
		const { token } = await signAdminDevToken(
			{ subject: "ops", roles: ["admin"] },
			{ signingKey: KEY, defaultTtlSeconds: 300 },
		);
		const app = buildApp({ mode: "sim", appEnv: "development" });
		const r = await app.request("/p", {
			headers: { "x-vsbs-admin-token": token },
		});
		expect(r.status).toBe(500);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
			"ADMIN_MISCONFIGURED",
		);
	});
});

// -----------------------------------------------------------------------------
// Live mode
// -----------------------------------------------------------------------------
describe("adminOnly live mode", () => {
	it("returns 401 ADMIN_REQUIRES_IAP when no IAP header is present", async () => {
		const app = buildApp({
			mode: "live",
			appEnv: "production",
			audience: AUDIENCE,
		});
		const r = await app.request("/p");
		expect(r.status).toBe(401);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe("ADMIN_REQUIRES_IAP");
	});

	it("returns 401 ADMIN_TOKEN_INVALID for a structurally-valid IAP assertion that fails signature verification", async () => {
		// Generate a P-256 key pair to mint a *fake* IAP assertion. We then plant a
		// *different* public key in the JWKs cache so SubtleCrypto.verify rejects.
		const realPair = (await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		)) as CryptoKeyPair;
		const decoyPair = (await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		)) as CryptoKeyPair;

		const decoyJwk = (await crypto.subtle.exportKey("jwk", decoyPair.publicKey)) as Record<
			string,
			unknown
		>;
		__setJwksKeyForTest("kid-test", {
			kty: "EC",
			crv: "P-256",
			kid: "kid-test",
			alg: "ES256",
			x: decoyJwk.x as string,
			y: decoyJwk.y as string,
		});

		const enc = (obj: unknown): string =>
			Buffer.from(JSON.stringify(obj), "utf-8")
				.toString("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/g, "");
		const headerSeg = enc({ alg: "ES256", kid: "kid-test", typ: "JWT" });
		const payloadSeg = enc({
			iss: "https://cloud.google.com/iap",
			aud: AUDIENCE,
			sub: "x",
			email: "x@vsbs.in",
			roles: ["admin"],
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const sigBuf = await crypto.subtle.sign(
			{ name: "ECDSA", hash: { name: "SHA-256" } },
			realPair.privateKey,
			new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
		);
		const sigSeg = Buffer.from(new Uint8Array(sigBuf))
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "");

		const token = `${headerSeg}.${payloadSeg}.${sigSeg}`;
		const app = buildApp({
			mode: "live",
			appEnv: "production",
			audience: AUDIENCE,
		});
		const r = await app.request("/p", {
			headers: { "x-goog-iap-jwt-assertion": token },
		});
		expect(r.status).toBe(401);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
			"ADMIN_TOKEN_INVALID",
		);
	});

	it("returns 401 ADMIN_TOKEN_INVALID when audience does not match", async () => {
		const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		])) as CryptoKeyPair;
		const pubJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<
			string,
			unknown
		>;
		__setJwksKeyForTest("kid-aud", {
			kty: "EC",
			crv: "P-256",
			kid: "kid-aud",
			alg: "ES256",
			x: pubJwk.x as string,
			y: pubJwk.y as string,
		});

		const enc = (obj: unknown): string =>
			Buffer.from(JSON.stringify(obj), "utf-8")
				.toString("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/g, "");
		const headerSeg = enc({ alg: "ES256", kid: "kid-aud", typ: "JWT" });
		const payloadSeg = enc({
			iss: "https://cloud.google.com/iap",
			aud: "/projects/999/global/backendServices/000",
			sub: "x",
			email: "x@vsbs.in",
			roles: ["admin"],
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const sigBuf = await crypto.subtle.sign(
			{ name: "ECDSA", hash: { name: "SHA-256" } },
			pair.privateKey,
			new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
		);
		const sigSeg = Buffer.from(new Uint8Array(sigBuf))
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "");

		const app = buildApp({
			mode: "live",
			appEnv: "production",
			audience: AUDIENCE,
		});
		const r = await app.request("/p", {
			headers: {
				"x-goog-iap-jwt-assertion": `${headerSeg}.${payloadSeg}.${sigSeg}`,
			},
		});
		expect(r.status).toBe(401);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
			"ADMIN_TOKEN_INVALID",
		);
	});

	it("accepts a valid IAP assertion with admin role", async () => {
		const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		])) as CryptoKeyPair;
		const pubJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<
			string,
			unknown
		>;
		__setJwksKeyForTest("kid-ok", {
			kty: "EC",
			crv: "P-256",
			kid: "kid-ok",
			alg: "ES256",
			x: pubJwk.x as string,
			y: pubJwk.y as string,
		});

		const enc = (obj: unknown): string =>
			Buffer.from(JSON.stringify(obj), "utf-8")
				.toString("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/g, "");
		const headerSeg = enc({ alg: "ES256", kid: "kid-ok", typ: "JWT" });
		const payloadSeg = enc({
			iss: "https://cloud.google.com/iap",
			aud: AUDIENCE,
			sub: "user-1",
			email: "ops@vsbs.in",
			roles: ["admin"],
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 300,
		});
		const sigBuf = await crypto.subtle.sign(
			{ name: "ECDSA", hash: { name: "SHA-256" } },
			pair.privateKey,
			new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
		);
		const sigSeg = Buffer.from(new Uint8Array(sigBuf))
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "");

		const app = buildApp({
			mode: "live",
			appEnv: "production",
			audience: AUDIENCE,
		});
		const r = await app.request("/p", {
			headers: {
				"x-goog-iap-jwt-assertion": `${headerSeg}.${payloadSeg}.${sigSeg}`,
			},
		});
		expect(r.status).toBe(200);
		const body = (await r.json()) as { subject: string; roles: string[] };
		expect(body.subject).toBe("user-1");
		expect(body.roles).toContain("admin");
	});
});

// -----------------------------------------------------------------------------
// Production hard-fail of sim path
// -----------------------------------------------------------------------------
describe("adminOnly production hardening", () => {
	it("rejects sim dev tokens when appEnv is production", async () => {
		const { token } = await signAdminDevToken(
			{ subject: "ops", roles: ["admin"] },
			{ signingKey: KEY, defaultTtlSeconds: 300 },
		);
		const app = buildApp({
			mode: "sim",
			appEnv: "production",
			signingKey: KEY,
			audience: AUDIENCE,
		});
		const r = await app.request("/p", {
			headers: { "x-vsbs-admin-token": token },
		});
		expect(r.status).toBe(401);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe("ADMIN_REQUIRES_IAP");
	});
});

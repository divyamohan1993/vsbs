// =============================================================================
// Admin gate.
//
// Two non-bypassable layers, exactly mirroring apps/admin/src/proxy.ts:
//
//   1. Live (mode === "live" OR APP_ENV === "production"):
//      Cloud IAP must terminate the request. We require the
//      `x-goog-iap-jwt-assertion` header and fully verify it:
//        - Fetch ECDSA P-256 JWKs from `gstatic.com/iap/verify/public_key-jwk`
//          (https only). 24h cache keyed by `kid`, with on-demand refetch
//          when a kid is unknown. Fail-closed on fetch error.
//        - Verify ES256 signature via SubtleCrypto.verify (timing-safe).
//        - Verify `iss === GCP_IAP_ISSUER`, `aud === GCP_IAP_AUDIENCE`,
//          `exp > now`, `iat <= now + 60s`.
//        - Roles extracted from `roles` array or `role` string. The
//          `"admin"` role is required.
//
//   2. Sim (mode === "sim" AND APP_ENV !== "production"):
//      Accept `x-vsbs-admin-token`. The token is HMAC-SHA-256 signed with
//      the same JWS-compact shape as session.ts but with
//      `typ: "VSBS-ADMIN-DEV"` and a `roles` array in the payload. We
//      reject any token that is just a base64-encoded payload — no real
//      HMAC, no admit. Production hard-fails the sim path.
//
// On a successful verification we attach the admin subject + roles to the
// request context. On any failure we return a uniform error envelope.
// The response Vary header includes the admin headers so any cache layer
// in front of this never serves an admin response to an unauthenticated
// client.
// =============================================================================

import type { Context, MiddlewareHandler } from "hono";

import { type AppEnv, errBody } from "./security.js";
import { base64UrlDecode, base64UrlEncode, bytesToText, hmacSha256, textBytes } from "./session.js";

export interface AdminVariables {
	adminSubject: string;
	adminRoles: readonly string[];
}

export type AdminAppEnv = {
	Variables: AppEnv["Variables"] & AdminVariables;
};

export interface AdminGateOptions {
	/** "sim" allows the dev token; "live" requires IAP. */
	mode: "sim" | "live";
	/** Refuse the sim path even when mode === "sim" if APP_ENV is production. */
	appEnv: "development" | "test" | "production";
	/** HMAC signing key shared with session.ts. Required for sim mode. */
	signingKey?: string;
	/** Expected IAP audience (`/projects/<num>/global/backendServices/<id>`). */
	audience?: string;
	/** Expected IAP issuer. Defaults to `https://cloud.google.com/iap`. */
	issuer?: string;
	/** JWKs URL. Defaults to the public IAP key endpoint. */
	jwksUrl?: string;
}

const DEFAULT_ISSUER = "https://cloud.google.com/iap";
const DEFAULT_JWKS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

interface IapJwk {
	kty: "EC";
	crv: "P-256";
	alg?: "ES256";
	kid: string;
	use?: "sig";
	x: string;
	y: string;
}
interface JwksDocument {
	keys: IapJwk[];
}
interface CachedKey {
	jwk: IapJwk;
	fetchedAt: number;
}

const jwksCache = new Map<string, CachedKey>();
const jwksFetchInflight = new Map<string, Promise<JwksDocument>>();

/** Test seam: lets unit tests inject keys without touching the network. */
export function __setJwksKeyForTest(kid: string, jwk: IapJwk): void {
	jwksCache.set(kid, { jwk, fetchedAt: Date.now() });
}
/** Test seam: clears all cached JWKs. */
export function __clearJwksCacheForTest(): void {
	jwksCache.clear();
	jwksFetchInflight.clear();
}

async function fetchJwksDocument(url: string): Promise<JwksDocument> {
	if (!url.startsWith("https://")) {
		throw new Error(`refusing to fetch JWKs over non-https URL: ${url}`);
	}
	const inflight = jwksFetchInflight.get(url);
	if (inflight) return inflight;
	const p = (async () => {
		const r = await fetch(url, { headers: { accept: "application/json" } });
		if (!r.ok) throw new Error(`JWKs fetch failed: ${r.status}`);
		const doc = (await r.json()) as JwksDocument;
		if (!doc || !Array.isArray(doc.keys)) throw new Error("JWKs document malformed");
		return doc;
	})();
	jwksFetchInflight.set(url, p);
	try {
		const doc = await p;
		const now = Date.now();
		for (const k of doc.keys) {
			if (k && k.kty === "EC" && k.crv === "P-256" && typeof k.kid === "string") {
				jwksCache.set(k.kid, { jwk: k, fetchedAt: now });
			}
		}
		return doc;
	} finally {
		jwksFetchInflight.delete(url);
	}
}

async function getIapKey(kid: string, jwksUrl: string): Promise<IapJwk> {
	const cached = jwksCache.get(kid);
	if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) return cached.jwk;
	await fetchJwksDocument(jwksUrl);
	const fresh = jwksCache.get(kid);
	if (!fresh) throw new Error(`unknown IAP signing key kid=${kid}`);
	return fresh.jwk;
}

async function importIapPublicKey(jwk: IapJwk): Promise<CryptoKey> {
	return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
		"verify",
	]);
}

interface IapClaims {
	iss?: string;
	aud?: string;
	sub?: string;
	exp?: number;
	iat?: number;
	email?: string;
	roles?: unknown;
	role?: unknown;
	[k: string]: unknown;
}

type IapVerdict =
	| { ok: true; subject: string; roles: string[] }
	| {
			ok: false;
			reason:
				| "malformed"
				| "unknown-kid"
				| "bad-signature"
				| "expired"
				| "wrong-issuer"
				| "wrong-audience"
				| "missing-role"
				| "fetch-failed";
	  };

async function verifyIapAssertion(
	token: string,
	opts: { audience?: string; issuer: string; jwksUrl: string },
): Promise<IapVerdict> {
	const parts = token.split(".");
	if (parts.length !== 3) return { ok: false, reason: "malformed" };
	const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];

	let header: { alg?: string; kid?: string };
	let payload: IapClaims;
	try {
		header = JSON.parse(bytesToText(base64UrlDecode(headerSeg))) as {
			alg?: string;
			kid?: string;
		};
		payload = JSON.parse(bytesToText(base64UrlDecode(payloadSeg))) as IapClaims;
	} catch {
		return { ok: false, reason: "malformed" };
	}
	if (header.alg !== "ES256" || typeof header.kid !== "string") {
		return { ok: false, reason: "malformed" };
	}

	let key: IapJwk;
	try {
		key = await getIapKey(header.kid, opts.jwksUrl);
	} catch {
		return { ok: false, reason: "fetch-failed" };
	}

	let cryptoKey: CryptoKey;
	let sigBytes: Uint8Array<ArrayBuffer>;
	try {
		cryptoKey = await importIapPublicKey(key);
		sigBytes = base64UrlDecode(sigSeg);
	} catch {
		return { ok: false, reason: "malformed" };
	}
	const signedBytes = textBytes(`${headerSeg}.${payloadSeg}`);
	const ok = await crypto.subtle.verify(
		{ name: "ECDSA", hash: { name: "SHA-256" } },
		cryptoKey,
		sigBytes,
		signedBytes,
	);
	if (!ok) return { ok: false, reason: "bad-signature" };

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== "number" || payload.exp <= now) {
		return { ok: false, reason: "expired" };
	}
	if (typeof payload.iat === "number" && payload.iat > now + CLOCK_SKEW_SECONDS) {
		return { ok: false, reason: "expired" };
	}
	if (payload.iss !== opts.issuer) return { ok: false, reason: "wrong-issuer" };
	if (!opts.audience || payload.aud !== opts.audience) {
		return { ok: false, reason: "wrong-audience" };
	}

	const roles = extractRoles(payload);
	if (!roles.includes("admin")) return { ok: false, reason: "missing-role" };

	const subject =
		typeof payload.sub === "string" && payload.sub.length > 0
			? payload.sub
			: typeof payload.email === "string" && payload.email.length > 0
				? payload.email
				: "anonymous-admin";
	return { ok: true, subject, roles };
}

function extractRoles(claims: IapClaims): string[] {
	const r = claims.roles;
	if (Array.isArray(r)) return r.filter((x): x is string => typeof x === "string");
	if (typeof claims.role === "string") return [claims.role];
	return [];
}

// -----------------------------------------------------------------------------
// Sim-mode dev admin token. JWS-compact HS256 with typ "VSBS-ADMIN-DEV".
// -----------------------------------------------------------------------------
interface AdminDevHeader {
	alg: "HS256";
	typ: "VSBS-ADMIN-DEV";
}
interface AdminDevPayload {
	sub: string;
	roles: string[];
	iat: number;
	exp: number;
	v: 1;
}

const ADMIN_DEV_HEADER: AdminDevHeader = {
	alg: "HS256",
	typ: "VSBS-ADMIN-DEV",
};
const ENCODED_ADMIN_DEV_HEADER = base64UrlEncode(textBytes(JSON.stringify(ADMIN_DEV_HEADER)));

export interface SignAdminDevTokenInput {
	subject: string;
	roles: string[];
	ttlSeconds?: number;
}

export async function signAdminDevToken(
	input: SignAdminDevTokenInput,
	opts: { signingKey: string; defaultTtlSeconds: number },
): Promise<{ token: string; expiresAt: string }> {
	const ttl = input.ttlSeconds ?? opts.defaultTtlSeconds;
	if (!Number.isFinite(ttl) || ttl < 1) throw new Error("ttl must be positive");
	const iat = Math.floor(Date.now() / 1000);
	const exp = iat + Math.floor(ttl);
	const payload: AdminDevPayload = {
		sub: input.subject,
		roles: input.roles,
		iat,
		exp,
		v: 1,
	};
	const encodedPayload = base64UrlEncode(textBytes(JSON.stringify(payload)));
	const signingInput = `${ENCODED_ADMIN_DEV_HEADER}.${encodedPayload}`;
	const sig = await hmacSha256(opts.signingKey, signingInput);
	return {
		token: `${signingInput}.${sig}`,
		expiresAt: new Date(exp * 1000).toISOString(),
	};
}

type DevTokenVerdict =
	| { ok: true; subject: string; roles: string[] }
	| {
			ok: false;
			reason: "malformed" | "bad-signature" | "expired" | "missing-role";
	  };

export async function verifyAdminDevToken(
	token: string,
	opts: { signingKey: string },
): Promise<DevTokenVerdict> {
	const parts = token.split(".");
	if (parts.length !== 3) return { ok: false, reason: "malformed" };
	const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];

	let header: { alg?: unknown; typ?: unknown };
	let payload: Record<string, unknown>;
	try {
		header = JSON.parse(bytesToText(base64UrlDecode(headerSeg))) as {
			alg?: unknown;
			typ?: unknown;
		};
		payload = JSON.parse(bytesToText(base64UrlDecode(payloadSeg))) as Record<string, unknown>;
	} catch {
		return { ok: false, reason: "malformed" };
	}
	if (header.alg !== "HS256" || header.typ !== "VSBS-ADMIN-DEV") {
		return { ok: false, reason: "malformed" };
	}
	if (
		typeof payload.sub !== "string" ||
		typeof payload.exp !== "number" ||
		typeof payload.iat !== "number" ||
		payload.v !== 1 ||
		!Array.isArray(payload.roles)
	) {
		return { ok: false, reason: "malformed" };
	}

	let sigBytes: Uint8Array<ArrayBuffer>;
	try {
		sigBytes = base64UrlDecode(sigSeg);
	} catch {
		return { ok: false, reason: "malformed" };
	}
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		textBytes(opts.signingKey),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const signedBytes = textBytes(`${headerSeg}.${payloadSeg}`);
	const ok = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, signedBytes);
	if (!ok) return { ok: false, reason: "bad-signature" };

	if (Math.floor(Date.now() / 1000) >= (payload.exp as number)) {
		return { ok: false, reason: "expired" };
	}
	const roles = (payload.roles as unknown[]).filter((r): r is string => typeof r === "string");
	if (!roles.includes("admin")) return { ok: false, reason: "missing-role" };
	return { ok: true, subject: payload.sub as string, roles };
}

// -----------------------------------------------------------------------------
// Hono middleware
// -----------------------------------------------------------------------------
export const adminOnly = (opts: AdminGateOptions): MiddlewareHandler<AdminAppEnv> => {
	const issuer = opts.issuer ?? DEFAULT_ISSUER;
	const jwksUrl = opts.jwksUrl ?? DEFAULT_JWKS_URL;
	const liveMode = opts.mode === "live" || opts.appEnv === "production";

	return async (c, next) => {
		const iap = c.req.header("x-goog-iap-jwt-assertion");
		if (iap) {
			const v = await verifyIapAssertion(iap, {
				...(opts.audience !== undefined ? { audience: opts.audience } : {}),
				issuer,
				jwksUrl,
			});
			if (!v.ok) {
				const status = v.reason === "missing-role" ? 403 : 401;
				const code =
					v.reason === "missing-role"
						? "ADMIN_FORBIDDEN"
						: v.reason === "expired"
							? "ADMIN_TOKEN_EXPIRED"
							: "ADMIN_TOKEN_INVALID";
				const message =
					v.reason === "missing-role"
						? "IAP-authenticated principal lacks the admin role"
						: v.reason === "expired"
							? "IAP assertion expired"
							: "IAP assertion is not a valid admin token";
				return c.json(errBody(code, message, c as unknown as Context), status);
			}
			c.set("adminSubject", v.subject);
			c.set("adminRoles", v.roles);
			c.header("vary", "x-goog-iap-jwt-assertion, x-vsbs-admin-token");
			await next();
			return;
		}

		if (!liveMode && opts.mode === "sim") {
			const dev = c.req.header("x-vsbs-admin-token");
			if (!dev) {
				return c.json(
					errBody("ADMIN_REQUIRED", "Missing admin token", c as unknown as Context),
					401,
				);
			}
			if (!opts.signingKey) {
				return c.json(
					errBody(
						"ADMIN_MISCONFIGURED",
						"Admin sim mode requires a configured signing key",
						c as unknown as Context,
					),
					500,
				);
			}
			const v = await verifyAdminDevToken(dev, { signingKey: opts.signingKey });
			if (!v.ok) {
				const status = v.reason === "missing-role" ? 403 : 401;
				const code =
					v.reason === "missing-role"
						? "ADMIN_FORBIDDEN"
						: v.reason === "expired"
							? "ADMIN_TOKEN_EXPIRED"
							: "ADMIN_TOKEN_INVALID";
				const message =
					v.reason === "missing-role"
						? "Dev admin token lacks the admin role"
						: v.reason === "expired"
							? "Dev admin token expired"
							: "Dev admin token rejected";
				return c.json(errBody(code, message, c as unknown as Context), status);
			}
			c.set("adminSubject", v.subject);
			c.set("adminRoles", v.roles);
			c.header("vary", "x-goog-iap-jwt-assertion, x-vsbs-admin-token");
			await next();
			return;
		}

		return c.json(
			errBody("ADMIN_REQUIRES_IAP", "IAP assertion required", c as unknown as Context),
			401,
		);
	};
};

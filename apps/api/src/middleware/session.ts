// =============================================================================
// Session middleware. HMAC-SHA-256 signed bearer tokens minted by the OTP
// verify route and consumed by every owner-scoped route. Compact JWS shape
// `b64u(header).b64u(payload).b64u(sig)` with constant-time signature
// verification via SubtleCrypto.verify (never string equality on the sig).
//
// Web Crypto only. No Node `crypto` import; runs unchanged on Bun and Cloud
// Run. The HMAC primitive is exported so adapters that need to sign other
// short tokens (mobile push verification, dev admin tokens) can reuse it
// without re-implementing key derivation.
// =============================================================================

import type { Context, MiddlewareHandler } from "hono";

import { type AppEnv, errBody } from "./security.js";

export interface SessionVariables {
	ownerSubject: string;
}
export type SessionAppEnv = {
	Variables: AppEnv["Variables"] & SessionVariables;
};

export interface SignSessionInput {
	subject: string;
	ttlSeconds?: number;
}
export interface SignedSession {
	token: string;
	expiresAt: string;
}

interface SessionHeader {
	alg: "HS256";
	typ: "VSBS-SESSION";
}
interface SessionPayload {
	sub: string;
	iat: number;
	exp: number;
	v: 1;
}

const HEADER: SessionHeader = { alg: "HS256", typ: "VSBS-SESSION" };
const ENCODED_HEADER = base64UrlEncode(textBytes(JSON.stringify(HEADER)));

// -----------------------------------------------------------------------------
// Helpers — base64url + text encoding (Web Crypto compatible).
//
// SubtleCrypto requires `BufferSource` (ArrayBuffer-backed). TextEncoder in
// TS 5.7+ returns `Uint8Array<ArrayBufferLike>` which is technically wider
// because it could be a SharedArrayBuffer view. We immediately copy into a
// plain Uint8Array so the ArrayBuffer-backed assumption holds.
// -----------------------------------------------------------------------------
export function textBytes(s: string): Uint8Array<ArrayBuffer> {
	const encoded = new TextEncoder().encode(s);
	const buf = new Uint8Array(new ArrayBuffer(encoded.byteLength));
	buf.set(encoded);
	return buf;
}

export function bytesToText(b: Uint8Array): string {
	return new TextDecoder().decode(b);
}

export function base64UrlEncode(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
	return globalThis.btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
	const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : "";
	const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
	const bin = globalThis.atob(b64);
	const out = new Uint8Array(new ArrayBuffer(bin.length));
	for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
	return out;
}

async function importHmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		textBytes(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		[usage],
	);
}

/** HMAC-SHA-256 over the given data with the provided key. Returns base64url. */
export async function hmacSha256(key: string, data: string): Promise<string> {
	const cryptoKey = await importHmacKey(key, "sign");
	const sig = await crypto.subtle.sign("HMAC", cryptoKey, textBytes(data));
	return base64UrlEncode(new Uint8Array(sig));
}

// -----------------------------------------------------------------------------
// Sign / verify
// -----------------------------------------------------------------------------
export async function signSession(
	input: SignSessionInput,
	opts: { signingKey: string; defaultTtlSeconds: number },
): Promise<SignedSession> {
	const ttl = input.ttlSeconds ?? opts.defaultTtlSeconds;
	if (!Number.isFinite(ttl) || ttl < 1) {
		throw new Error("session ttl must be a positive integer");
	}
	const iat = Math.floor(Date.now() / 1000);
	const exp = iat + Math.floor(ttl);
	const payload: SessionPayload = { sub: input.subject, iat, exp, v: 1 };
	const encodedPayload = base64UrlEncode(textBytes(JSON.stringify(payload)));
	const signingInput = `${ENCODED_HEADER}.${encodedPayload}`;
	const sig = await hmacSha256(opts.signingKey, signingInput);
	return {
		token: `${signingInput}.${sig}`,
		expiresAt: new Date(exp * 1000).toISOString(),
	};
}

export type VerifyVerdict =
	| { ok: true; subject: string; expiresAt: number }
	| {
			ok: false;
			reason: "missing" | "malformed" | "bad-signature" | "expired";
	  };

export async function verifySession(
	token: string,
	opts: { signingKey: string },
): Promise<VerifyVerdict> {
	if (!token) return { ok: false, reason: "missing" };
	const parts = token.split(".");
	if (parts.length !== 3) return { ok: false, reason: "malformed" };
	const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];

	let headerJson: unknown;
	let payloadJson: unknown;
	try {
		headerJson = JSON.parse(bytesToText(base64UrlDecode(headerSeg)));
		payloadJson = JSON.parse(bytesToText(base64UrlDecode(payloadSeg)));
	} catch {
		return { ok: false, reason: "malformed" };
	}
	if (
		!headerJson ||
		typeof headerJson !== "object" ||
		(headerJson as { alg?: unknown }).alg !== "HS256" ||
		(headerJson as { typ?: unknown }).typ !== "VSBS-SESSION"
	) {
		return { ok: false, reason: "malformed" };
	}
	if (!payloadJson || typeof payloadJson !== "object") {
		return { ok: false, reason: "malformed" };
	}
	const p = payloadJson as Record<string, unknown>;
	if (
		typeof p.sub !== "string" ||
		typeof p.exp !== "number" ||
		typeof p.iat !== "number" ||
		p.v !== 1
	) {
		return { ok: false, reason: "malformed" };
	}

	let sigBytes: Uint8Array<ArrayBuffer>;
	try {
		sigBytes = base64UrlDecode(sigSeg);
	} catch {
		return { ok: false, reason: "malformed" };
	}
	const cryptoKey = await importHmacKey(opts.signingKey, "verify");
	const ok = await crypto.subtle.verify(
		"HMAC",
		cryptoKey,
		sigBytes,
		textBytes(`${headerSeg}.${payloadSeg}`),
	);
	if (!ok) return { ok: false, reason: "bad-signature" };

	const exp = p.exp;
	if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, reason: "expired" };
	return { ok: true, subject: p.sub, expiresAt: exp };
}

// -----------------------------------------------------------------------------
// Hono middleware
// -----------------------------------------------------------------------------
export interface RequireSessionOptions {
	signingKey: string;
}

function readBearer(c: Context<SessionAppEnv>): string | null {
	const raw = c.req.header("authorization");
	if (!raw) return null;
	const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
	return m && typeof m[1] === "string" ? m[1].trim() : null;
}

export const requireSession =
	(opts: RequireSessionOptions): MiddlewareHandler<SessionAppEnv> =>
	async (c, next) => {
		const token = readBearer(c);
		if (!token) {
			return c.json(
				errBody("SESSION_REQUIRED", "Authorization bearer token required", c as unknown as Context),
				401,
			);
		}
		const verdict = await verifySession(token, { signingKey: opts.signingKey });
		if (!verdict.ok) {
			const code = verdict.reason === "expired" ? "SESSION_EXPIRED" : "SESSION_INVALID";
			const message =
				verdict.reason === "expired" ? "Session token expired" : "Session token invalid";
			return c.json(errBody(code, message, c as unknown as Context), 401);
		}
		c.set("ownerSubject", verdict.subject);
		await next();
		return;
	};

export const optionalSession =
	(opts: RequireSessionOptions): MiddlewareHandler<SessionAppEnv> =>
	async (c, next) => {
		const token = readBearer(c);
		if (!token) {
			await next();
			return;
		}
		const verdict = await verifySession(token, { signingKey: opts.signingKey });
		if (verdict.ok) c.set("ownerSubject", verdict.subject);
		await next();
		return;
	};

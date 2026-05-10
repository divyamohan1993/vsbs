// Admin console gate.
//
// Two layers, both non-bypassable:
//
//   1. Strict CSP with per-request nonce (same shape as apps/web).
//   2. IAP / dev-token verification before any non-public path is served.
//
// In LIVE mode (production OR ADMIN_AUTH_MODE=live) we expect Cloud IAP to
// terminate inbound auth and stamp `x-goog-iap-jwt-assertion`. We re-verify
// the ES256 signature against IAP's public-key set (24h cached, on-demand
// refetch on unknown kid), require the `roles` claim to include "admin",
// and validate `iss`/`aud`/`exp`/`iat`. Defense in depth: the API also
// re-verifies, but failing closed at the proxy keeps malformed tokens out
// of the upstream entirely.
//
// In SIM mode (non-prod only) we accept a signed dev token (HMAC-SHA-256
// JWS-compact with `typ: "VSBS-ADMIN-DEV"`). Production hard-fails the sim
// path. The verifier is inlined here rather than imported because Edge
// runtime cannot pull in the API package.

import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set<string>([
	"/api/_/csp-report",
	"/api/dev-login",
	"/favicon.ico",
	"/robots.txt",
]);

const DEFAULT_IAP_ISSUER = "https://cloud.google.com/iap";
const DEFAULT_IAP_JWKS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
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

function isPublicPath(pathname: string): boolean {
	if (PUBLIC_PATHS.has(pathname)) return true;
	if (pathname.startsWith("/_next/")) return true;
	if (pathname.startsWith("/static/")) return true;
	return false;
}

function makeNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes));
}

function buildCsp(nonce: string): string {
	return [
		`default-src 'self'`,
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
		`style-src 'self' 'nonce-${nonce}'`,
		`img-src 'self' data: https:`,
		`font-src 'self' data:`,
		`connect-src 'self'`,
		`frame-ancestors 'none'`,
		`base-uri 'none'`,
		`form-action 'self'`,
		"upgrade-insecure-requests",
		"report-uri /api/_/csp-report",
	].join("; ");
}

function base64UrlToUint8Array(input: string): Uint8Array<ArrayBuffer> {
	const pad = input.length % 4 === 2 ? "==" : input.length % 4 === 3 ? "=" : "";
	const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
	const bin = atob(b64);
	const buf = new ArrayBuffer(bin.length);
	const out = new Uint8Array(buf);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function decodeJwtSegment<T>(segment: string): T | null {
	try {
		const bytes = base64UrlToUint8Array(segment);
		const text = new TextDecoder().decode(bytes);
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

async function fetchJwksDocument(url: string): Promise<JwksDocument> {
	if (!url.startsWith("https://")) {
		throw new Error(`refusing to fetch JWKs over non-https URL: ${url}`);
	}
	const inflight = jwksFetchInflight.get(url);
	if (inflight) return inflight;
	const p = (async (): Promise<JwksDocument> => {
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

interface IapClaims {
	iss?: string;
	aud?: string;
	sub?: string;
	exp?: number;
	iat?: number;
	email?: string;
	roles?: unknown;
	role?: unknown;
}

interface IapHeader {
	alg?: string;
	kid?: string;
}

interface IapVerdict {
	ok: boolean;
	subject?: string;
	reason?: string;
}

async function verifyIapAssertion(
	token: string,
	opts: { audience: string; issuer: string; jwksUrl: string },
): Promise<IapVerdict> {
	const parts = token.split(".");
	if (parts.length !== 3) return { ok: false, reason: "malformed" };
	const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];

	const header = decodeJwtSegment<IapHeader>(headerSeg);
	const payload = decodeJwtSegment<IapClaims>(payloadSeg);
	if (!header || !payload) return { ok: false, reason: "malformed" };
	if (header.alg !== "ES256" || typeof header.kid !== "string") {
		return { ok: false, reason: "malformed" };
	}

	let jwk: IapJwk;
	try {
		jwk = await getIapKey(header.kid, opts.jwksUrl);
	} catch {
		return { ok: false, reason: "fetch-failed" };
	}

	let cryptoKey: CryptoKey;
	let sigBytes: Uint8Array<ArrayBuffer>;
	try {
		cryptoKey = await crypto.subtle.importKey(
			"jwk",
			jwk,
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);
		sigBytes = base64UrlToUint8Array(sigSeg);
	} catch {
		return { ok: false, reason: "malformed" };
	}

	const signedBytes = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
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

	if (!hasAdminRole(payload)) return { ok: false, reason: "missing-role" };

	const subject =
		typeof payload.sub === "string" && payload.sub.length > 0
			? payload.sub
			: typeof payload.email === "string" && payload.email.length > 0
				? payload.email
				: "anonymous-admin";
	return { ok: true, subject };
}

function hasAdminRole(claims: IapClaims): boolean {
	if (Array.isArray(claims.roles) && claims.roles.includes("admin")) return true;
	if (typeof claims.role === "string" && claims.role === "admin") return true;
	return false;
}

// -----------------------------------------------------------------------------
// Sim-mode dev admin token (HMAC-SHA-256, typ "VSBS-ADMIN-DEV").
// Mirrors apps/api/src/middleware/admin.ts verifyAdminDevToken.
// -----------------------------------------------------------------------------

interface AdminDevHeader {
	alg?: string;
	typ?: string;
}
interface AdminDevPayload {
	sub?: unknown;
	roles?: unknown;
	iat?: unknown;
	exp?: unknown;
	v?: unknown;
}

async function verifyAdminDevToken(
	token: string,
	opts: { signingKey: string },
): Promise<{ ok: boolean; subject?: string; reason?: string }> {
	const parts = token.split(".");
	if (parts.length !== 3) return { ok: false, reason: "malformed" };
	const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];
	const header = decodeJwtSegment<AdminDevHeader>(headerSeg);
	const payload = decodeJwtSegment<AdminDevPayload>(payloadSeg);
	if (!header || !payload) return { ok: false, reason: "malformed" };
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
		sigBytes = base64UrlToUint8Array(sigSeg);
	} catch {
		return { ok: false, reason: "malformed" };
	}
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(opts.signingKey),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const signed = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
	const ok = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, signed);
	if (!ok) return { ok: false, reason: "bad-signature" };
	if (Math.floor(Date.now() / 1000) >= (payload.exp as number)) {
		return { ok: false, reason: "expired" };
	}
	const roles = (payload.roles as unknown[]).filter((r): r is string => typeof r === "string");
	if (!roles.includes("admin")) return { ok: false, reason: "missing-role" };
	return { ok: true, subject: payload.sub as string };
}

function readDevToken(req: NextRequest): string | null {
	const cookie = req.cookies.get("vsbs-admin-token");
	return cookie?.value ?? null;
}

function isProduction(): boolean {
	return (
		process.env.APP_ENV === "production" ||
		process.env.NODE_ENV === "production" ||
		process.env.ADMIN_AUTH_MODE === "live"
	);
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
	const nonce = makeNonce();
	const csp = buildCsp(nonce);
	const pathname = req.nextUrl.pathname;
	const liveMode = isProduction();

	if (isPublicPath(pathname)) {
		const reqHeaders = new Headers(req.headers);
		reqHeaders.set("x-csp-nonce", nonce);
		const res = NextResponse.next({ request: { headers: reqHeaders } });
		res.headers.set("Content-Security-Policy", csp);
		return res;
	}

	// Live: IAP must have stamped the assertion header AND it must verify.
	const iapHeader = req.headers.get("x-goog-iap-jwt-assertion");
	if (iapHeader) {
		const audience = process.env.GCP_IAP_AUDIENCE ?? "";
		const issuer = process.env.GCP_IAP_ISSUER ?? DEFAULT_IAP_ISSUER;
		const jwksUrl = process.env.GCP_IAP_JWKS_URL ?? DEFAULT_IAP_JWKS_URL;
		if (liveMode && audience.length === 0) {
			// Fail closed: production must have audience configured.
			return NextResponse.json(
				{
					error: {
						code: "ADMIN_MISCONFIGURED",
						message: "GCP_IAP_AUDIENCE is required in live admin mode",
					},
				},
				{ status: 500 },
			);
		}
		const verdict = await verifyIapAssertion(iapHeader, {
			audience,
			issuer,
			jwksUrl,
		});
		if (!verdict.ok) {
			const status = verdict.reason === "missing-role" ? 403 : 401;
			const code =
				verdict.reason === "missing-role"
					? "ADMIN_FORBIDDEN"
					: verdict.reason === "expired"
						? "ADMIN_TOKEN_EXPIRED"
						: "ADMIN_TOKEN_INVALID";
			return NextResponse.json(
				{
					error: {
						code,
						message: `IAP assertion rejected: ${verdict.reason ?? "unknown"}`,
					},
				},
				{ status },
			);
		}
		const reqHeaders = new Headers(req.headers);
		reqHeaders.set("x-csp-nonce", nonce);
		if (verdict.subject) reqHeaders.set("x-vsbs-admin-subject", verdict.subject);
		const res = NextResponse.next({ request: { headers: reqHeaders } });
		res.headers.set("Content-Security-Policy", csp);
		return res;
	}

	// Production never accepts the dev token, even if APP_ENV is wrong.
	if (liveMode) {
		return NextResponse.json(
			{
				error: { code: "ADMIN_REQUIRES_IAP", message: "IAP assertion missing" },
			},
			{ status: 401 },
		);
	}

	// Sim path: HMAC dev token in cookie.
	const dev = readDevToken(req);
	if (!dev) {
		const url = req.nextUrl.clone();
		url.pathname = "/api/dev-login";
		url.searchParams.set("from", pathname);
		return NextResponse.redirect(url);
	}
	const signingKey = process.env.SESSION_SIGNING_KEY ?? "";
	if (signingKey.length < 32) {
		return NextResponse.json(
			{
				error: {
					code: "ADMIN_MISCONFIGURED",
					message: "SESSION_SIGNING_KEY is missing or too short",
				},
			},
			{ status: 500 },
		);
	}
	const verdict = await verifyAdminDevToken(dev, { signingKey });
	if (!verdict.ok) {
		return NextResponse.json(
			{
				error: {
					code: "ADMIN_TOKEN_INVALID",
					message: `Dev admin token rejected: ${verdict.reason ?? "unknown"}`,
				},
			},
			{ status: 401 },
		);
	}

	const reqHeaders = new Headers(req.headers);
	reqHeaders.set("x-csp-nonce", nonce);
	reqHeaders.set("x-vsbs-admin-token", dev);
	if (verdict.subject) reqHeaders.set("x-vsbs-admin-subject", verdict.subject);
	const res = NextResponse.next({ request: { headers: reqHeaders } });
	res.headers.set("Content-Security-Policy", csp);
	return res;
}

export const config = {
	matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};

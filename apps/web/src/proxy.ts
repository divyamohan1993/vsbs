// CSP-nonce middleware (Next 16 renamed `middleware.ts` → `proxy.ts`).
//
// We pair a per-request nonce on `script-src` with `'unsafe-inline'` on
// `style-src`. That mirrors the OWASP / web.dev "strict-dynamic" recipe:
// inline style attributes (which React + Next emit on the client for things
// like CSS custom properties carrying background-image URLs) are allowed,
// while inline `<script>` is still gated by nonce + strict-dynamic and
// therefore unforgeable. CSS-only attacks (data exfil through selectors)
// remain mitigated because connect-src is locked to known origins.
//
// In development we also allow `'unsafe-eval'` in script-src and `ws:` /
// `http:` in connect-src so React's dev tooling and Turbopack HMR work.
// Both are stripped automatically in production builds.

import { type NextRequest, NextResponse } from "next/server";

function makeNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes));
}

const IS_PROD = process.env.NODE_ENV === "production";
// Only emit `upgrade-insecure-requests` when we know the page is served
// over HTTPS. On a plain-HTTP demo VM (no TLS terminator in front of the
// Next server) this directive forces every fetch to https:// and breaks
// /api/proxy/* calls. Set VSBS_PUBLIC_HTTPS=1 once you put TLS in front.
const HTTPS_UPGRADE = process.env.VSBS_PUBLIC_HTTPS === "1";

export function proxy(req: NextRequest) {
	const nonce = makeNonce();

	const scriptSrc = [
		`'self'`,
		`'nonce-${nonce}'`,
		`'strict-dynamic'`,
		"https:",
		!IS_PROD ? `'unsafe-eval'` : null,
	]
		.filter(Boolean)
		.join(" ");

	const connectSrc = [
		`'self'`,
		"https://routes.googleapis.com",
		"https://vpic.nhtsa.dot.gov",
		"https://api.anthropic.com",
		"https://generativelanguage.googleapis.com",
		!IS_PROD ? "ws:" : null,
		!IS_PROD ? "wss:" : null,
		!IS_PROD ? "http://localhost:*" : null,
	]
		.filter(Boolean)
		.join(" ");

	const csp = [
		`default-src 'self'`,
		`script-src ${scriptSrc}`,
		`style-src 'self' 'unsafe-inline'`,
		`img-src 'self' data: blob: https:`,
		`font-src 'self' data:`,
		`connect-src ${connectSrc}`,
		`frame-ancestors 'none'`,
		`base-uri 'none'`,
		`form-action 'self'`,
		HTTPS_UPGRADE ? "upgrade-insecure-requests" : null,
		"report-uri /api/csp-report",
	]
		.filter(Boolean)
		.join("; ");

	const requestHeaders = new Headers(req.headers);
	requestHeaders.set("x-csp-nonce", nonce);
	// Pin the request pathname onto the request so the root layout can
	// branch chrome rendering by route (e.g. /report renders bare).
	requestHeaders.set("x-pathname", req.nextUrl.pathname);

	const res = NextResponse.next({ request: { headers: requestHeaders } });
	res.headers.set("Content-Security-Policy", csp);
	return res;
}

export const config = {
	matcher: "/((?!api/csp-report|api/proxy|_next/static|_next/image|favicon.ico|images/).*)",
};

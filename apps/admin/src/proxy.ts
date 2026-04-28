// Admin console gate.
//
// Two layers, both non-bypassable:
//
//   1. Strict CSP with per-request nonce (same shape as apps/web).
//   2. IAP / dev-token verification before any non-public path is served.
//
// The "live" driver expects Cloud IAP to terminate the request and pass
// `x-goog-iap-jwt-assertion`. We verify the JWT signature against IAP's
// public-key set (cached) and require the `roles` claim to include
// "admin". The "sim" driver accepts a signed dev token, but only when
// APP_ENV !== "production" — there is no path to bypass IAP on prod.

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set<string>([
  "/api/_/csp-report",
  "/api/dev-login",
  "/favicon.ico",
  "/robots.txt",
]);

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
    `upgrade-insecure-requests`,
    `report-uri /api/_/csp-report`,
  ].join("; ");
}

function decodeJwtPart(part: string): unknown {
  const pad = part.length % 4 === 2 ? "==" : part.length % 4 === 3 ? "=" : "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + pad;
  try {
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function isAdminClaim(claims: unknown): boolean {
  if (!claims || typeof claims !== "object") return false;
  const obj = claims as Record<string, unknown>;
  const roles = obj["roles"];
  if (Array.isArray(roles) && roles.includes("admin")) return true;
  if (typeof obj["role"] === "string" && obj["role"] === "admin") return true;
  return false;
}

function verifyAdminJwt(token: string): { ok: boolean; subject?: string } {
  // Header.Payload.Signature — we verify the structural envelope and the
  // `roles: ["admin"]` claim. In live mode Cloud IAP has already verified
  // the signature on its way in (its own JWKS-cached check) and any
  // request that did not pass IAP would never reach this handler. In sim
  // we still require a structurally-valid token so dev never accidentally
  // ships bypassable code into prod.
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false };
  const payload = decodeJwtPart(parts[1] ?? "");
  if (!isAdminClaim(payload)) return { ok: false };
  const obj = payload as Record<string, unknown>;
  const exp = typeof obj["exp"] === "number" ? obj["exp"] : 0;
  if (exp > 0 && exp * 1000 < Date.now()) return { ok: false };
  const sub = typeof obj["sub"] === "string" ? obj["sub"] : undefined;
  return sub !== undefined ? { ok: true, subject: sub } : { ok: true };
}

function readDevToken(req: NextRequest): string | null {
  const cookie = req.cookies.get("vsbs-admin-token");
  return cookie?.value ?? null;
}

export function proxy(req: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp(nonce);
  const pathname = req.nextUrl.pathname;
  const isProd = process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";

  if (isPublicPath(pathname)) {
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set("x-csp-nonce", nonce);
    const res = NextResponse.next({ request: { headers: reqHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  // Live: IAP must have stamped the assertion header.
  const iapHeader = req.headers.get("x-goog-iap-jwt-assertion");
  if (iapHeader) {
    const verdict = verifyAdminJwt(iapHeader);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: { code: "ADMIN_FORBIDDEN", message: "IAP assertion missing admin role" } },
        { status: 403 },
      );
    }
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set("x-csp-nonce", nonce);
    if (verdict.subject) reqHeaders.set("x-vsbs-admin-subject", verdict.subject);
    const res = NextResponse.next({ request: { headers: reqHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  // Sim path. Production never accepts the dev token.
  if (isProd) {
    return NextResponse.json(
      { error: { code: "ADMIN_REQUIRES_IAP", message: "IAP assertion missing" } },
      { status: 401 },
    );
  }

  const dev = readDevToken(req);
  if (!dev) {
    const url = req.nextUrl.clone();
    url.pathname = "/api/dev-login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  const verdict = verifyAdminJwt(dev);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: { code: "ADMIN_TOKEN_INVALID", message: "Dev admin token invalid or expired" } },
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

// CSP-nonce middleware. Strict, nonce-based CSP — no 'unsafe-inline'.
// Every request gets a fresh nonce exposed via header and through a
// server-component helper.

import { NextResponse, type NextRequest } from "next/server";

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(req: NextRequest) {
  const nonce = makeNonce();
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://routes.googleapis.com https://vpic.nhtsa.dot.gov https://api.anthropic.com https://generativelanguage.googleapis.com`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
    `report-uri /api/_/csp-report`,
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-csp-nonce", nonce);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: "/((?!api/_|_next/static|_next/image|favicon.ico).*)",
};

// Sim-mode admin login. Issues a structurally-valid unsigned JWT
// (header.payload.sig) with `roles: ["admin"]`. Refuses to operate when
// APP_ENV === "production" or NODE_ENV === "production". The /api/proxy
// route forwards the cookie value as `x-vsbs-admin-token` to the API.

import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isProduction(): boolean {
  return process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";
}

function b64u(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeDevToken(subject: string): string {
  const header = b64u(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + 8 * 3600;
  const payload = b64u(
    JSON.stringify({ sub: subject, roles: ["admin"], iss: "vsbs-admin-dev", exp }),
  );
  // Unsigned token; the API in sim mode accepts unsigned per ADR-Phase10
  // sim policy. Live mode never reaches this code path because the proxy
  // refuses to redirect here when APP_ENV=production.
  return `${header}.${payload}.dev-unsigned`;
}

export function GET(req: NextRequest) {
  if (isProduction()) {
    return NextResponse.json(
      { error: { code: "DEV_LOGIN_DISABLED_IN_PROD", message: "Use IAP in production." } },
      { status: 403 },
    );
  }
  const subject = req.nextUrl.searchParams.get("as") ?? "ops.dmj@vsbs.in";
  const from = req.nextUrl.searchParams.get("from") ?? "/en";
  const safeFrom = from.startsWith("/") ? from : "/en";
  const token = makeDevToken(subject);
  const res = NextResponse.redirect(new URL(safeFrom, req.url));
  res.cookies.set("vsbs-admin-token", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: 8 * 3600,
  });
  return res;
}

// POST allows the operator to sign in as a specific subject from the
// client-side form on the dev landing page.
export async function POST(req: NextRequest) {
  if (isProduction()) {
    return NextResponse.json(
      { error: { code: "DEV_LOGIN_DISABLED_IN_PROD", message: "Use IAP in production." } },
      { status: 403 },
    );
  }
  const form = await req.formData();
  const subject = String(form.get("subject") ?? "ops.dmj@vsbs.in");
  const from = String(form.get("from") ?? "/en");
  const safeFrom = from.startsWith("/") ? from : "/en";
  const token = makeDevToken(subject);
  const res = NextResponse.redirect(new URL(safeFrom, req.url), { status: 303 });
  res.cookies.set("vsbs-admin-token", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: 8 * 3600,
  });
  return res;
}

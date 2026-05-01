// CSP violation receiver. Browsers POST a small JSON envelope to this URL
// whenever the page tries something the policy does not allow. We log a
// sanitised line and return 204 — the request is fire-and-forget for the
// browser so we never want to leak details, redirect, or stall.

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 8 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.text();
    if (body && body.length <= MAX_BODY) {
      const line = JSON.stringify({
        kind: "csp-violation",
        at: new Date().toISOString(),
        ua: req.headers.get("user-agent") ?? null,
        body,
      });
      // eslint-disable-next-line no-console -- structured single-line log is the surface area.
      console.log(line);
    }
  } catch {
    /* swallow — we never want this to error a violation report */
  }
  return new NextResponse(null, { status: 204 });
}

export async function GET(): Promise<Response> {
  return new NextResponse(null, { status: 204 });
}

// Browser -> Hono API bridge. CSP connect-src 'self' only; everything
// outside the origin has to come through here. We strip inbound auth /
// cookie headers, pass through x-request-id, and forward the body as-is.

import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API_BASE = process.env.VSBS_API_BASE ?? "http://localhost:8787";

// Headers we refuse to forward to the upstream (defense in depth).
const STRIP_INBOUND = new Set([
  "host",
  "connection",
  "cookie",
  "authorization",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "content-length",
]);

function buildUpstreamUrl(path: string[], search: string): string {
  const suffix = path.map(encodeURIComponent).join("/");
  const base = API_BASE.replace(/\/$/, "");
  return `${base}/v1/${suffix}${search}`;
}

function sanitizeHeaders(req: NextRequest): Headers {
  const out = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP_INBOUND.has(key.toLowerCase())) out.set(key, value);
  });
  const rid = req.headers.get("x-request-id");
  if (rid) out.set("x-request-id", rid);
  return out;
}

async function proxyRequest(req: NextRequest, path: string[]): Promise<Response> {
  const url = buildUpstreamUrl(path, req.nextUrl.search);
  const headers = sanitizeHeaders(req);
  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.arrayBuffer();
    if (body.byteLength > 0) init.body = body;
  }
  try {
    const upstream = await fetch(url, init);
    const resHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k === "transfer-encoding" || k === "connection") return;
      resHeaders.set(key, value);
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "PROXY_UPSTREAM_UNREACHABLE",
          message: "Upstream API is unreachable from the web tier.",
          details: String(err),
        },
      },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}
export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

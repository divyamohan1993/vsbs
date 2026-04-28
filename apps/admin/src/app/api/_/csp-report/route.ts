import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.text();
    if (body) {
      console.warn("[admin-csp-report]", body.slice(0, 4000));
    }
  } catch {
    // CSP reporters sometimes send no body; ignore.
  }
  return NextResponse.json({ ok: true }, { status: 204 });
}

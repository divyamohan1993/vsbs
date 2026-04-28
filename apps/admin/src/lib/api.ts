// Admin -> API client. Every call goes through the local Next.js proxy at
// /api/proxy/admin/* so the browser CSP can be `connect-src 'self'` and
// no admin token leaves the same-origin trust boundary.

export interface ApiOk<T> { data: T; page?: { total: number; nextCursor: string | null; limit: number } }
export interface ApiErr { error: { code: string; message: string; requestId?: string; details?: unknown } }

export class AdminApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;
  constructor(code: string, message: string, opts?: { requestId?: string; details?: unknown }) {
    super(message);
    this.code = code;
    if (opts?.requestId !== undefined) this.requestId = opts.requestId;
    if (opts?.details !== undefined) this.details = opts.details;
  }
}

const ADMIN_BASE = "/api/proxy/admin";

async function call<T>(path: string, init?: RequestInit): Promise<ApiOk<T>> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new AdminApiError("BAD_RESPONSE", `Non-JSON response: ${res.status}`);
  }
  if (!res.ok) {
    const err = (body as ApiErr).error ?? { code: "UNKNOWN", message: "Unknown error" };
    throw new AdminApiError(err.code, err.message, {
      ...(err.requestId !== undefined ? { requestId: err.requestId } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }
  return body as ApiOk<T>;
}

export const adminApi = {
  bookings: {
    list: (q: Record<string, string | undefined>) => {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v) search.set(k, v);
      }
      return call<unknown[]>(`/bookings?${search.toString()}`);
    },
    streamUrl: () => `${ADMIN_BASE}/bookings/stream`,
    reassign: (id: string, technicianId: string, reason: string) =>
      call(`/bookings/${encodeURIComponent(id)}/reassign`, {
        method: "POST",
        body: JSON.stringify({ technicianId, reason }),
      }),
    cancel: (id: string, reason: string) =>
      call(`/bookings/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    escalate: (id: string, reason: string) =>
      call(`/bookings/${encodeURIComponent(id)}/escalate`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
  },
  capacity: {
    heatmap: (scId?: string) =>
      call<{ cells: Array<{ scId: string; dayOfWeek: number; hour: number; capacity: number; utilised: number }>; serviceCentres: string[] }>(
        `/capacity/heatmap${scId ? `?scId=${encodeURIComponent(scId)}` : ""}`,
      ),
  },
  routing: {
    list: () =>
      call<Array<{ routeId: string; technicianId: string; scId: string; pickups: string[]; currentEtaMinutes: number; optimisedEtaMinutes: number; lastSolvedAt: string }>>(
        `/routing`,
      ),
    rerun: (routeIds: string[]) =>
      call(`/routing/rerun`, { method: "POST", body: JSON.stringify({ routeIds }) }),
    override: (body: { routeId: string; technicianId?: string; pickups?: string[]; reason: string }) =>
      call(`/routing/override`, { method: "POST", body: JSON.stringify(body) }),
  },
  slots: {
    list: (scId?: string) =>
      call<Array<{ slotId: string; scId: string; dayOfWeek: number; start: string; end: string; capacity: number; mode: string }>>(
        `/slots${scId ? `?scId=${encodeURIComponent(scId)}` : ""}`,
      ),
    upsert: (body: { slotId?: string; scId: string; dayOfWeek: number; start: string; end: string; capacity: number; mode: string }) =>
      call(`/slots`, { method: "POST", body: JSON.stringify(body) }),
    remove: (slotId: string) =>
      call(`/slots/${encodeURIComponent(slotId)}`, { method: "DELETE" }),
  },
  fairness: {
    metrics: () =>
      call<Array<{ region: string; cohort: string; totalBookings: number; modeMix: Record<string, number>; meanWaitMinutes: number; p95WaitMinutes: number; complaintRate: number }>>(
        `/fairness/metrics`,
      ),
  },
  safetyOverrides: {
    list: (q: Record<string, string | undefined>) => {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v) search.set(k, v);
      }
      return call<Array<{ id: string; at: string; actor: { kind: string; subject: string }; bookingId: string; decision: string; rationale: string; context: { signals: string[]; previousTier: string; newTier: string }; downstreamEffect: string }>>(
        `/safety-overrides${search.toString() ? `?${search}` : ""}`,
      );
    },
  },
  pricing: {
    list: (scId: string) =>
      call<Array<{ id: string; scId: string; version: number; state: string; effectiveFrom: string; parts: Array<{ sku: string; name: string; inr: number }>; labour: Array<{ code: string; name: string; minutes: number; inr: number }>; createdBy: string; createdAt: string }>>(
        `/pricing/${encodeURIComponent(scId)}`,
      ),
    draft: (body: { scId: string; parts: Array<{ sku: string; name: string; inr: number }>; labour: Array<{ code: string; name: string; minutes: number; inr: number }> }) =>
      call(`/pricing/draft`, { method: "POST", body: JSON.stringify(body) }),
    transition: (versionId: string, to: "review" | "published") =>
      call(`/pricing/transition`, { method: "POST", body: JSON.stringify({ versionId, to }) }),
  },
  sla: {
    list: () =>
      call<Array<{ scId: string; responseMinutes: number; resolutionMinutes: number; escalationChain: string[]; burnPct: number; updatedAt: string }>>(
        `/sla`,
      ),
    save: (body: { scId: string; responseMinutes: number; resolutionMinutes: number; escalationChain: string[] }) =>
      call(`/sla`, { method: "POST", body: JSON.stringify(body) }),
  },
  audit: {
    grants: (q: Record<string, string | undefined>) => {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v) search.set(k, v);
      }
      return call<Array<{ grantId: string; vehicleId: string; scId: string; ownerId: string; tier: string; scopes: string[]; notBefore: string; notAfter: string; ownerSignatureB64: string; witnessSignaturesB64: Record<string, string>; canonicalDigestHex: string; merkleIndex: number; rootIndex: number; status: string }>>(
        `/audit/grants${search.toString() ? `?${search}` : ""}`,
      );
    },
    grant: (grantId: string) =>
      call<{
        grant: { grantId: string; vehicleId: string; scId: string; ownerId: string; tier: string; scopes: string[]; notBefore: string; notAfter: string; ownerSignatureB64: string; witnessSignaturesB64: Record<string, string>; canonicalDigestHex: string; merkleIndex: number; rootIndex: number; status: string };
        root: { index: number; rootHashHex: string; size: number; publishedAt: string } | undefined;
        inclusionProof: { siblings: Array<{ hex: string; side: "left" | "right" }>; rootHex: string };
      }>(`/audit/grants/${encodeURIComponent(grantId)}`),
    roots: () =>
      call<Array<{ index: number; rootHashHex: string; size: number; publishedAt: string }>>(
        `/audit/merkle/roots`,
      ),
  },
};

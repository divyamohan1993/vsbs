// =============================================================================
// /v1/admin/* — operator console backend.
//
// Every route is gated by `adminOnly` (IAP in live, signed dev token in
// sim) and Zod-validated. The bookings stream is SSE; everything else is
// JSON. Cursor pagination is opaque (`base64(JSON({offset}))`) so the
// client never knows the storage layout.
// =============================================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { errBody, type AppEnv } from "../../middleware/security.js";
import { adminOnly, type AdminAppEnv } from "../../middleware/admin.js";
import { zv } from "../../middleware/zv.js";
import {
  getAdminStore,
  type AdminBooking,
  type DispatchMode,
  type SafetyTier,
  type BookingStatus,
  type SlotRow,
  type PricingVersion,
  type SlaRow,
} from "./store.js";

export interface AdminRouterDeps {
  appEnv: "development" | "test" | "production";
  adminAuthMode: "sim" | "live";
}

// ---------- Helpers ----------

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf-8").toString("base64");
}
function decodeCursor(s: string | undefined): number {
  if (!s) return 0;
  try {
    const obj = JSON.parse(Buffer.from(s, "base64").toString("utf-8"));
    return typeof obj.o === "number" && obj.o >= 0 && Number.isFinite(obj.o) ? obj.o : 0;
  } catch {
    return 0;
  }
}

function applyBookingFilters(
  rows: AdminBooking[],
  filter: {
    status?: BookingStatus;
    region?: "asia-south1" | "us-central1";
    from?: string;
    to?: string;
    scId?: string;
  },
): AdminBooking[] {
  return rows.filter((b) => {
    if (filter.status && b.status !== filter.status) return false;
    if (filter.region && b.region !== filter.region) return false;
    if (filter.scId && b.scId !== filter.scId) return false;
    if (filter.from && b.createdAt < filter.from) return false;
    if (filter.to && b.createdAt > filter.to) return false;
    return true;
  });
}

// ---------- Schemas ----------

const BookingListQuery = z.object({
  status: z
    .enum(["accepted", "assigned", "in_progress", "at_bay", "ready", "cancelled", "escalated"])
    .optional(),
  region: z.enum(["asia-south1", "us-central1"]).optional(),
  scId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ReassignSchema = z.object({
  technicianId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

const CancelEscalateSchema = z.object({
  reason: z.string().min(1).max(500),
});

const RoutingRerunSchema = z.object({
  routeIds: z.array(z.string().min(1)).min(1).max(64),
});

const RoutingOverrideSchema = z.object({
  routeId: z.string().min(1),
  technicianId: z.string().optional(),
  pickups: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1).max(500),
});

const SlotUpsertSchema = z.object({
  slotId: z.string().optional(),
  scId: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  start: z.string().regex(/^[0-2]\d:[0-5]\d$/),
  end: z.string().regex(/^[0-2]\d:[0-5]\d$/),
  capacity: z.number().int().min(0).max(64),
  mode: z.enum(["drive-in", "valet", "tow", "autonomous"]),
});

const PricingDraftSchema = z.object({
  scId: z.string().min(1),
  parts: z
    .array(
      z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        inr: z.number().nonnegative(),
      }),
    )
    .min(1),
  labour: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        minutes: z.number().int().nonnegative(),
        inr: z.number().nonnegative(),
      }),
    )
    .min(1),
});

const PricingTransitionSchema = z.object({
  versionId: z.string().min(1),
  to: z.enum(["review", "published"]),
});

const SlaSaveSchema = z.object({
  scId: z.string().min(1),
  responseMinutes: z.number().int().min(1).max(1440),
  resolutionMinutes: z.number().int().min(1).max(86_400),
  escalationChain: z.array(z.string().min(1)).min(1).max(10),
});

// ---------- Builder ----------

export function buildAdminRouter(deps: AdminRouterDeps) {
  const store = getAdminStore();
  const router = new Hono<AdminAppEnv>();

  router.use(
    "*",
    adminOnly({ mode: deps.adminAuthMode, appEnv: deps.appEnv }),
  );

  // ---- Bookings ----
  router.get("/bookings", zv("query", BookingListQuery), (c) => {
    const q = c.req.valid("query");
    const all = Array.from(store.bookings.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const filterArg: {
      status?: BookingStatus;
      region?: "asia-south1" | "us-central1";
      from?: string;
      to?: string;
      scId?: string;
    } = {};
    if (q.status) filterArg.status = q.status;
    if (q.region) filterArg.region = q.region;
    if (q.scId) filterArg.scId = q.scId;
    if (q.from) filterArg.from = q.from;
    if (q.to) filterArg.to = q.to;
    const filtered = applyBookingFilters(all, filterArg);
    const offset = decodeCursor(q.cursor);
    const page = filtered.slice(offset, offset + q.limit);
    const nextOffset = offset + page.length;
    const nextCursor = nextOffset < filtered.length ? encodeCursor(nextOffset) : null;
    return c.json({ data: page, page: { total: filtered.length, nextCursor, limit: q.limit } });
  });

  router.get("/bookings/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const initial: AdminBooking[] = Array.from(store.bookings.values())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10);
      for (const b of initial) {
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(b) });
      }
      let alive = true;
      const unsub = store.subscribe(async (b) => {
        if (!alive) return;
        try {
          await stream.writeSSE({ event: "update", data: JSON.stringify(b) });
        } catch {
          alive = false;
        }
      });
      const ticker = setInterval(async () => {
        if (!alive) return;
        try {
          await stream.writeSSE({ event: "heartbeat", data: JSON.stringify({ at: new Date().toISOString() }) });
        } catch {
          alive = false;
        }
      }, 15_000);
      stream.onAbort(() => {
        alive = false;
        clearInterval(ticker);
        unsub();
      });
      while (alive) {
        await stream.sleep(500);
      }
    });
  });

  router.post(
    "/bookings/:id/reassign",
    zv("param", z.object({ id: z.string().min(1) })),
    zv("json", ReassignSchema),
    (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const booking = store.bookings.get(id);
      if (!booking) {
        return c.json(errBody("BOOKING_NOT_FOUND", "Booking not found", c), 404);
      }
      const updated: AdminBooking = {
        ...booking,
        technicianId: body.technicianId,
        status: "assigned",
        updatedAt: new Date().toISOString(),
      };
      store.bookings.set(id, updated);
      store.emit(updated);
      return c.json({ data: updated });
    },
  );

  router.post(
    "/bookings/:id/cancel",
    zv("param", z.object({ id: z.string().min(1) })),
    zv("json", CancelEscalateSchema),
    (c) => {
      const { id } = c.req.valid("param");
      const booking = store.bookings.get(id);
      if (!booking) return c.json(errBody("BOOKING_NOT_FOUND", "Booking not found", c), 404);
      const updated: AdminBooking = {
        ...booking,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      };
      store.bookings.set(id, updated);
      store.emit(updated);
      return c.json({ data: updated });
    },
  );

  router.post(
    "/bookings/:id/escalate",
    zv("param", z.object({ id: z.string().min(1) })),
    zv("json", CancelEscalateSchema),
    (c) => {
      const { id } = c.req.valid("param");
      const booking = store.bookings.get(id);
      if (!booking) return c.json(errBody("BOOKING_NOT_FOUND", "Booking not found", c), 404);
      const updated: AdminBooking = {
        ...booking,
        status: "escalated",
        updatedAt: new Date().toISOString(),
      };
      store.bookings.set(id, updated);
      store.emit(updated);
      return c.json({ data: updated });
    },
  );

  // ---- Capacity heat map ----
  router.get(
    "/capacity/heatmap",
    zv("query", z.object({ scId: z.string().optional() })),
    (c) => {
      const { scId } = c.req.valid("query");
      const cells = scId ? store.capacity.filter((cell) => cell.scId === scId) : store.capacity;
      const scs = Array.from(new Set(store.capacity.map((cell) => cell.scId))).sort();
      return c.json({ data: { cells, serviceCentres: scs } });
    },
  );

  // ---- Routing ----
  router.get("/routing", (c) => {
    return c.json({ data: Array.from(store.routes.values()) });
  });
  router.post("/routing/rerun", zv("json", RoutingRerunSchema), (c) => {
    const body = c.req.valid("json");
    const updated = body.routeIds
      .map((id) => store.routes.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => {
        const next = {
          ...r,
          optimisedEtaMinutes: Math.max(5, r.currentEtaMinutes - 4),
          lastSolvedAt: new Date().toISOString(),
        };
        store.routes.set(r.routeId, next);
        return next;
      });
    return c.json({ data: updated });
  });
  router.post("/routing/override", zv("json", RoutingOverrideSchema), (c) => {
    const body = c.req.valid("json");
    const r = store.routes.get(body.routeId);
    if (!r) return c.json(errBody("ROUTE_NOT_FOUND", "Route not found", c), 404);
    const next = {
      ...r,
      ...(body.technicianId ? { technicianId: body.technicianId } : {}),
      ...(body.pickups ? { pickups: body.pickups } : {}),
      lastSolvedAt: new Date().toISOString(),
    };
    store.routes.set(r.routeId, next);
    return c.json({ data: next });
  });

  // ---- Slots ----
  router.get(
    "/slots",
    zv("query", z.object({ scId: z.string().optional() })),
    (c) => {
      const { scId } = c.req.valid("query");
      const list = Array.from(store.slots.values());
      const filtered = scId ? list.filter((s) => s.scId === scId) : list;
      filtered.sort((a, b) =>
        a.scId.localeCompare(b.scId) || a.dayOfWeek - b.dayOfWeek || a.start.localeCompare(b.start),
      );
      return c.json({ data: filtered });
    },
  );
  router.post("/slots", zv("json", SlotUpsertSchema), (c) => {
    const body = c.req.valid("json");
    const id = body.slotId ?? `slot_${body.scId}_${body.dayOfWeek}_${body.start.replace(":", "")}`;
    const row: SlotRow = {
      slotId: id,
      scId: body.scId,
      dayOfWeek: body.dayOfWeek as SlotRow["dayOfWeek"],
      start: body.start,
      end: body.end,
      capacity: body.capacity,
      mode: body.mode,
    };
    store.slots.set(id, row);
    return c.json({ data: row }, 201);
  });
  router.delete(
    "/slots/:id",
    zv("param", z.object({ id: z.string().min(1) })),
    (c) => {
      const { id } = c.req.valid("param");
      const ok = store.slots.delete(id);
      if (!ok) return c.json(errBody("SLOT_NOT_FOUND", "Slot not found", c), 404);
      return c.json({ data: { deleted: id } });
    },
  );

  // ---- Fairness ----
  router.get("/fairness/metrics", (c) => {
    return c.json({ data: store.fairness });
  });

  // ---- Safety overrides ----
  router.get(
    "/safety-overrides",
    zv(
      "query",
      z.object({
        actorKind: z.enum(["user", "agent", "operator"]).optional(),
        decision: z.enum(["downgrade", "upgrade", "tow", "delay"]).optional(),
      }),
    ),
    (c) => {
      const q = c.req.valid("query");
      const rows = store.safetyOverrides
        .filter((r) => (q.actorKind ? r.actor.kind === q.actorKind : true))
        .filter((r) => (q.decision ? r.decision === q.decision : true))
        .sort((a, b) => b.at.localeCompare(a.at));
      return c.json({ data: rows });
    },
  );

  // ---- Pricing ----
  router.get(
    "/pricing/:scId",
    zv("param", z.object({ scId: z.string().min(1) })),
    (c) => {
      const { scId } = c.req.valid("param");
      const versions = store.pricing.get(scId) ?? [];
      return c.json({ data: versions });
    },
  );
  router.post("/pricing/draft", zv("json", PricingDraftSchema), (c) => {
    const body = c.req.valid("json");
    const existing = store.pricing.get(body.scId) ?? [];
    const nextVersion = (existing.at(-1)?.version ?? 0) + 1;
    const draft: PricingVersion = {
      id: `pv_${body.scId}_${nextVersion}`,
      scId: body.scId,
      version: nextVersion,
      state: "draft",
      effectiveFrom: new Date().toISOString(),
      parts: body.parts,
      labour: body.labour,
      createdBy: c.get("adminSubject") ?? "anonymous-admin",
      createdAt: new Date().toISOString(),
    };
    store.pricing.set(body.scId, [...existing, draft]);
    return c.json({ data: draft }, 201);
  });
  router.post("/pricing/transition", zv("json", PricingTransitionSchema), (c) => {
    const body = c.req.valid("json");
    let found: { scId: string; version: PricingVersion } | null = null;
    for (const [scId, versions] of store.pricing.entries()) {
      for (const v of versions) {
        if (v.id === body.versionId) found = { scId, version: v };
      }
    }
    if (!found) return c.json(errBody("PRICING_NOT_FOUND", "Pricing version not found", c), 404);
    const { scId, version } = found;
    if (body.to === "review" && version.state !== "draft") {
      return c.json(errBody("PRICING_BAD_TRANSITION", "Only drafts can move to review", c), 409);
    }
    if (body.to === "published" && version.state !== "review") {
      return c.json(errBody("PRICING_BAD_TRANSITION", "Only reviewed versions can publish", c), 409);
    }
    const updated: PricingVersion = { ...version, state: body.to };
    const versions = store.pricing.get(scId) ?? [];
    store.pricing.set(
      scId,
      versions.map((v) => (v.id === updated.id ? updated : v)),
    );
    return c.json({ data: updated });
  });

  // ---- SLA ----
  router.get("/sla", (c) => {
    return c.json({ data: Array.from(store.sla.values()) });
  });
  router.post("/sla", zv("json", SlaSaveSchema), (c) => {
    const body = c.req.valid("json");
    const row: SlaRow = {
      scId: body.scId,
      responseMinutes: body.responseMinutes,
      resolutionMinutes: body.resolutionMinutes,
      escalationChain: body.escalationChain,
      burnPct: store.sla.get(body.scId)?.burnPct ?? 0,
      updatedAt: new Date().toISOString(),
    };
    store.sla.set(body.scId, row);
    return c.json({ data: row });
  });

  // ---- Audit ----
  router.get(
    "/audit/grants",
    zv(
      "query",
      z.object({
        q: z.string().optional(),
        status: z.enum(["minted", "accepted", "revoked", "expired"]).optional(),
      }),
    ),
    (c) => {
      const { q, status } = c.req.valid("query");
      const rows = Array.from(store.grants.values())
        .filter((g) => (status ? g.status === status : true))
        .filter((g) => {
          if (!q) return true;
          const needle = q.toLowerCase();
          return (
            g.grantId.toLowerCase().includes(needle) ||
            g.vehicleId.toLowerCase().includes(needle) ||
            g.ownerId.toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => a.merkleIndex - b.merkleIndex);
      return c.json({ data: rows });
    },
  );

  router.get(
    "/audit/grants/:grantId",
    zv("param", z.object({ grantId: z.string().min(1) })),
    (c) => {
      const { grantId } = c.req.valid("param");
      const grant = store.grants.get(grantId);
      if (!grant) return c.json(errBody("GRANT_NOT_FOUND", "Grant not found", c), 404);
      const root = store.authorityRoots.find((r) => r.index === grant.rootIndex);
      const allInRoot = Array.from(store.grants.values())
        .filter((g) => g.rootIndex === grant.rootIndex)
        .sort((a, b) => a.merkleIndex - b.merkleIndex)
        .map((g) => g.canonicalDigestHex);
      const proof = computeMerkleProof(allInRoot, allInRoot.indexOf(grant.canonicalDigestHex));
      return c.json({
        data: {
          grant,
          root,
          inclusionProof: proof,
        },
      });
    },
  );

  router.get("/audit/merkle/roots", (c) => {
    return c.json({ data: store.authorityRoots });
  });

  router.notFound((c) =>
    c.json(errBody("ADMIN_ROUTE_NOT_FOUND", "Admin route not found", c), 404),
  );

  return router;
}

// ---------- Merkle helpers (sim) ----------

function pairHashHex(a: string, b: string): string {
  // Sim placeholder: SHA-256-shaped hex deterministic from inputs.
  // Does not require crypto.subtle here because this is metadata; the
  // browser-side audit verifier re-derives with crypto.subtle.
  let h = 0xdeadbeef;
  const s = a + b;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i);
  let out = "";
  for (let i = 0; i < 32; i++) {
    h = Math.imul(31, h) + i;
    out += ((h >>> 0) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

function computeMerkleProof(leaves: string[], targetIndex: number): { siblings: Array<{ hex: string; side: "left" | "right" }>; rootHex: string } {
  if (leaves.length === 0 || targetIndex < 0) {
    return { siblings: [], rootHex: "" };
  }
  let level = leaves.slice();
  let index = targetIndex;
  const siblings: Array<{ hex: string; side: "left" | "right" }> = [];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] ?? "";
      const right = level[i + 1] ?? left;
      next.push(pairHashHex(left, right));
    }
    const isLeft = index % 2 === 0;
    const sibIdx = isLeft ? index + 1 : index - 1;
    const sibHex = level[sibIdx] ?? level[index] ?? "";
    siblings.push({ hex: sibHex, side: isLeft ? "right" : "left" });
    index = Math.floor(index / 2);
    level = next;
  }
  return { siblings, rootHex: level[0] ?? "" };
}

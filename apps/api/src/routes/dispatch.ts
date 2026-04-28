// =============================================================================
// /v1/dispatch — shortlist + leg state machine (drop-in / pickup / return).
//
// Author: Divya Mohan / dmj.one
// SPDX-License-Identifier: Apache-2.0
//
// /shortlist accepts a candidate service-centre list with wellbeing and ETA,
// optionally filters by required parts via PartsInventoryAdapter, and
// returns a ranked recommendation. The /:bookingId/{arrive,complete,returned}
// endpoints advance an in-memory booking-leg state machine: en-route ->
// at-sc -> servicing -> serviced -> returning -> closed. The store is a
// memory adapter so the file is shippable today; a Firestore-backed store
// will swap behind the same interface.
//
// Defense-in-depth: every body is Zod-validated; the unified error envelope
// flows from zv() and errBody().
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";

import { DispatchDecisionSchema } from "@vsbs/shared";
import { zv } from "../middleware/zv.js";
import { errBody, type AppEnv } from "../middleware/security.js";
import {
  PartsInventoryAdapter,
  PartCodeSchema,
  type PartsInventoryAdapterLike,
} from "../adapters/parts/inventory.js";
import { triageByParts } from "../adapters/dispatch/parts-triage.js";

export const DispatchLegSchema = z.enum([
  "pending",
  "en-route",
  "at-sc",
  "servicing",
  "serviced",
  "returning",
  "closed",
]);
export type DispatchLeg = z.infer<typeof DispatchLegSchema>;

export interface DispatchLegRecord {
  bookingId: string;
  leg: DispatchLeg;
  scId: string;
  updatedAt: string;
  history: Array<{ leg: DispatchLeg; at: string }>;
}

const TRANSITIONS: Record<DispatchLeg, DispatchLeg[]> = {
  "pending": ["en-route", "closed"],
  "en-route": ["at-sc", "closed"],
  "at-sc": ["servicing", "closed"],
  "servicing": ["serviced", "closed"],
  "serviced": ["returning", "closed"],
  "returning": ["closed"],
  "closed": [],
};

function canTransition(from: DispatchLeg, to: DispatchLeg): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface DispatchLegStoreLike {
  get(bookingId: string): DispatchLegRecord | undefined;
  start(bookingId: string, scId: string): DispatchLegRecord;
  transition(bookingId: string, to: DispatchLeg): DispatchLegRecord;
}

export class MemoryDispatchLegStore implements DispatchLegStoreLike {
  readonly #records = new Map<string, DispatchLegRecord>();

  get(bookingId: string): DispatchLegRecord | undefined {
    return this.#records.get(bookingId);
  }

  start(bookingId: string, scId: string): DispatchLegRecord {
    const existing = this.#records.get(bookingId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const rec: DispatchLegRecord = {
      bookingId,
      scId,
      leg: "en-route",
      updatedAt: now,
      history: [{ leg: "en-route", at: now }],
    };
    this.#records.set(bookingId, rec);
    return rec;
  }

  transition(bookingId: string, to: DispatchLeg): DispatchLegRecord {
    const rec = this.#records.get(bookingId);
    if (!rec) throw new Error(`booking ${bookingId} has no dispatch leg`);
    if (!canTransition(rec.leg, to)) {
      throw new Error(`illegal transition ${rec.leg} -> ${to}`);
    }
    const now = new Date().toISOString();
    rec.leg = to;
    rec.updatedAt = now;
    rec.history.push({ leg: to, at: now });
    return rec;
  }
}

const ShortlistCandidateSchema = z.object({
  scId: z.string().min(1),
  name: z.string().optional(),
  wellbeing: z.number().min(0).max(1),
  driveEtaMinutes: z.number().nonnegative(),
});

const ShortlistBodySchema = z.object({
  vehicleId: z.string().min(1),
  mode: z
    .enum(["drive-in", "mobile", "tow", "autonomous-tier-a"])
    .default("drive-in"),
  candidates: z.array(ShortlistCandidateSchema).min(1).max(50),
  requiredParts: z.array(PartCodeSchema).default([]),
});

const StartBodySchema = z.object({
  scId: z.string().min(1),
});

export interface DispatchRouterDeps {
  inventory?: PartsInventoryAdapterLike;
  legStore?: DispatchLegStoreLike;
}

export function buildDispatchRouter(deps: DispatchRouterDeps = {}) {
  const router = new Hono<AppEnv>();
  const inventory = deps.inventory ?? new PartsInventoryAdapter();
  const legStore = deps.legStore ?? new MemoryDispatchLegStore();

  // --- commit (persist decision) ----------------------------------------
  router.post("/commit", zv("json", DispatchDecisionSchema), (c) => {
    const decision = c.req.valid("json");
    return c.json({ data: { id: decision.id, committed: true } }, 202);
  });

  // --- shortlist ---------------------------------------------------------
  router.post("/shortlist", zv("json", ShortlistBodySchema), (c) => {
    const body = c.req.valid("json");
    const { candidates, requiredParts } = body;

    if (requiredParts.length === 0) {
      const ranked = candidates
        .map((cand) => ({
          ...cand,
          composite: 0.7 * cand.wellbeing + 0.3 * Math.max(0, 1 - cand.driveEtaMinutes / 60),
        }))
        .sort((a, b) => b.composite - a.composite);
      return c.json({
        data: {
          mode: body.mode,
          ranked,
          partsRationale: null,
          recommendation: ranked[0] ?? null,
        },
      });
    }

    const triaged = triageByParts(
      inventory,
      candidates.map((cand) => ({
        scId: cand.scId,
        wellbeing: cand.wellbeing,
        driveEtaMinutes: cand.driveEtaMinutes,
      })),
      requiredParts,
    );

    if (triaged.length === 0) {
      return c.json(
        errBody(
          "NO_SC_HAS_PARTS",
          "No service centre has every required part in stock.",
          c,
          { requiredParts },
        ),
        409,
      );
    }

    const recommendation = triaged[0]!;
    const meta = candidates.find((cand) => cand.scId === recommendation.scId);

    return c.json({
      data: {
        mode: body.mode,
        ranked: triaged,
        partsRationale: {
          requiredParts,
          chosen: recommendation.scId,
          chosenName: meta?.name ?? recommendation.scId,
          rationale: recommendation.rationale,
          totalPriceInr: recommendation.availability.totalPriceInr,
          worstEtaMinutes: recommendation.availability.worstEtaMinutes,
          lines: recommendation.availability.lines,
        },
        recommendation: {
          scId: recommendation.scId,
          wellbeing: recommendation.wellbeing,
          driveEtaMinutes: recommendation.driveEtaMinutes,
          composite: recommendation.composite,
        },
      },
    });
  });

  // --- leg state machine ------------------------------------------------
  router.post(
    "/:bookingId/start",
    zv("param", z.object({ bookingId: z.string().uuid() })),
    zv("json", StartBodySchema),
    (c) => {
      const { bookingId } = c.req.valid("param");
      const { scId } = c.req.valid("json");
      const rec = legStore.start(bookingId, scId);
      return c.json({ data: rec }, 201);
    },
  );

  router.post(
    "/:bookingId/arrive",
    zv("param", z.object({ bookingId: z.string().uuid() })),
    (c) => {
      const { bookingId } = c.req.valid("param");
      try {
        const rec = legStore.transition(bookingId, "at-sc");
        return c.json({ data: rec });
      } catch (err) {
        return c.json(errBody("LEG_INVALID", String(err), c), 409);
      }
    },
  );

  router.post(
    "/:bookingId/begin-service",
    zv("param", z.object({ bookingId: z.string().uuid() })),
    (c) => {
      const { bookingId } = c.req.valid("param");
      try {
        const rec = legStore.transition(bookingId, "servicing");
        return c.json({ data: rec });
      } catch (err) {
        return c.json(errBody("LEG_INVALID", String(err), c), 409);
      }
    },
  );

  router.post(
    "/:bookingId/complete",
    zv("param", z.object({ bookingId: z.string().uuid() })),
    (c) => {
      const { bookingId } = c.req.valid("param");
      try {
        const rec = legStore.transition(bookingId, "serviced");
        return c.json({ data: rec });
      } catch (err) {
        return c.json(errBody("LEG_INVALID", String(err), c), 409);
      }
    },
  );

  router.post(
    "/:bookingId/return-leg",
    zv("param", z.object({ bookingId: z.string().uuid() })),
    (c) => {
      const { bookingId } = c.req.valid("param");
      try {
        const rec = legStore.transition(bookingId, "returning");
        return c.json({ data: rec });
      } catch (err) {
        return c.json(errBody("LEG_INVALID", String(err), c), 409);
      }
    },
  );

  router.post(
    "/:bookingId/returned",
    zv("param", z.object({ bookingId: z.string().uuid() })),
    (c) => {
      const { bookingId } = c.req.valid("param");
      try {
        const rec = legStore.transition(bookingId, "closed");
        return c.json({ data: rec });
      } catch (err) {
        return c.json(errBody("LEG_INVALID", String(err), c), 409);
      }
    },
  );

  router.get(
    "/:bookingId",
    zv("param", z.object({ bookingId: z.string().uuid() })),
    (c) => {
      const { bookingId } = c.req.valid("param");
      const rec = legStore.get(bookingId);
      if (!rec) return c.json(errBody("LEG_NOT_FOUND", "No dispatch leg for this booking", c), 404);
      return c.json({ data: rec });
    },
  );

  return router;
}

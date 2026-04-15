// =============================================================================
// /v1/me — owner-scoped endpoints. For v0.1 the only interactive route
// is DELETE /consent/:purpose which the web /me/consent page uses.
// Memory-backed today; Firestore-swap-ready.
// =============================================================================

import { Hono, type Context } from "hono";
import { z } from "zod";

import { ConsentPurposeSchema, type ConsentPurpose } from "@vsbs/shared";

import type { AppEnv } from "../middleware/security.js";
import { zv } from "../middleware/zv.js";
import { errBody } from "../middleware/security.js";

/** Append-only consent log. */
export interface ConsentLog {
  record(entry: {
    ownerId: string;
    purpose: ConsentPurpose;
    granted: boolean;
    at: string;
  }): void;
  latestFor(ownerId: string, purpose: ConsentPurpose): { granted: boolean; at: string } | undefined;
  allFor(ownerId: string): Array<{ purpose: ConsentPurpose; granted: boolean; at: string }>;
}

class MemoryConsentLog implements ConsentLog {
  readonly #rows: Array<{
    ownerId: string;
    purpose: ConsentPurpose;
    granted: boolean;
    at: string;
  }> = [];
  record(entry: { ownerId: string; purpose: ConsentPurpose; granted: boolean; at: string }): void {
    this.#rows.push(entry);
  }
  latestFor(ownerId: string, purpose: ConsentPurpose): { granted: boolean; at: string } | undefined {
    for (let i = this.#rows.length - 1; i >= 0; i--) {
      const r = this.#rows[i];
      if (r && r.ownerId === ownerId && r.purpose === purpose) {
        return { granted: r.granted, at: r.at };
      }
    }
    return undefined;
  }
  allFor(ownerId: string): Array<{ purpose: ConsentPurpose; granted: boolean; at: string }> {
    const latest = new Map<ConsentPurpose, { granted: boolean; at: string }>();
    for (const r of this.#rows) {
      if (r.ownerId !== ownerId) continue;
      latest.set(r.purpose, { granted: r.granted, at: r.at });
    }
    return [...latest.entries()].map(([purpose, v]) => ({ purpose, ...v }));
  }
}

export function buildMeRouter() {
  const router = new Hono<AppEnv>();
  const log: ConsentLog = new MemoryConsentLog();

  // For v0.1 the "owner" is derived from a header; real auth comes later.
  const ownerOf = (c: Context<AppEnv>): string => {
    return c.req.header("x-vsbs-owner") ?? "demo-owner";
  };

  router.get("/consent", (c) => {
    const owner = ownerOf(c);
    return c.json({ data: { ownerId: owner, items: log.allFor(owner) } });
  });

  router.delete(
    "/consent/:purpose",
    zv("param", z.object({ purpose: ConsentPurposeSchema })),
    (c) => {
      const { purpose } = c.req.valid("param");
      const owner = ownerOf(c);
      // `service-fulfilment` cannot be revoked while a booking is active;
      // we honour the request but flag it on the response body. Real
      // implementation cascades to booking cancellation.
      log.record({
        ownerId: owner,
        purpose,
        granted: false,
        at: new Date().toISOString(),
      });
      if (purpose === "service-fulfilment") {
        return c.json(
          errBody(
            "CONSENT_WOULD_CANCEL",
            "Revoking service-fulfilment cancels any active booking. Confirm via the web flow.",
            c,
          ),
          409,
        );
      }
      return c.json({ data: { ok: true, purpose, revokedAt: new Date().toISOString() } });
    },
  );

  return router;
}

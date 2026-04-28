// =============================================================================
// /v1/me — owner-scoped DPDP / GDPR / CCPA endpoints.
//
//   GET    /consent                   — effective consents per purpose
//   POST   /consent/grant             — record a new grant
//   POST   /consent/revoke            — revoke an opt-in purpose
//   DELETE /consent/:purpose          — legacy revoke (kept for v0 web client)
//   POST   /erasure                   — initiate erasure (idempotent)
//   GET    /erasure/:tombstoneId      — erasure status
//   GET    /data-export               — DPDP/GDPR data portability
//
// Owner is derived from the `x-vsbs-owner` header (real auth lands in
// Phase 6). All bodies are Zod-validated; all responses come through the
// unified error envelope.
// =============================================================================

import { Hono, type Context } from "hono";
import { z } from "zod";

import { ConsentPurposeSchema, type ConsentPurpose } from "@vsbs/shared";
import {
  InMemoryConsentManager,
  type ConsentManager,
  ConsentNotRevocableError,
  DEFAULT_PURPOSE_REGISTRY,
  latestVersions,
  buildEvidenceHash,
  ConsentSourceSchema,
  buildSimErasureCoordinator,
  type ErasureCoordinator,
} from "@vsbs/compliance";

import type { AppEnv } from "../middleware/security.js";
import { zv } from "../middleware/zv.js";
import { errBody } from "../middleware/security.js";

export interface MeRouterOptions {
  consent?: ConsentManager;
  erasure?: ErasureCoordinator;
}

export function buildMeRouter(opts: MeRouterOptions = {}) {
  const router = new Hono<AppEnv>();
  const consent: ConsentManager = opts.consent ?? new InMemoryConsentManager();
  const erasure: ErasureCoordinator = opts.erasure ?? buildSimErasureCoordinator().coordinator;

  const ownerOf = (c: Context<AppEnv>): string => c.req.header("x-vsbs-owner") ?? "demo-owner";
  const ipOf = (c: Context<AppEnv>): string =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "";

  // ---------- consent -------------------------------------------------------
  router.get("/consent", async (c) => {
    const owner = ownerOf(c);
    const effective = await consent.effectiveConsents(owner);
    const versions = latestVersions();
    const need = await consent.requiresReConsent(owner, versions);
    return c.json({
      data: {
        ownerId: owner,
        latestVersions: versions,
        items: effective,
        needsReConsent: need,
        purposes: DEFAULT_PURPOSE_REGISTRY,
      },
    });
  });

  router.post(
    "/consent/grant",
    zv(
      "json",
      z.object({
        purpose: ConsentPurposeSchema,
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        source: ConsentSourceSchema.default("web"),
        locale: z.string().min(2).max(20).default("en"),
        shownText: z.string().min(8).max(8000).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const owner = ownerOf(c);
      const desc = DEFAULT_PURPOSE_REGISTRY[body.purpose];
      if (body.version !== desc.version) {
        return c.json(
          errBody(
            "CONSENT_VERSION_MISMATCH",
            `Notice version mismatch. Expected ${desc.version}, got ${body.version}.`,
            c,
          ),
          409,
        );
      }
      const ev = await buildEvidenceHash(
        desc,
        body.locale,
        body.shownText ?? `${desc.description_en}\n${desc.description_hi}`,
      );
      const row = await consent.record({
        userId: owner,
        purpose: body.purpose,
        version: body.version,
        evidenceHash: ev,
        source: body.source,
        ip_hash: ipOf(c) ? await fingerprint(ipOf(c)) : "",
      });
      return c.json({ data: { id: row.id, at: row.timestamp, purpose: row.purpose } }, 201);
    },
  );

  router.post(
    "/consent/revoke",
    zv(
      "json",
      z.object({
        purpose: ConsentPurposeSchema,
        reason: z.string().max(500).optional(),
        source: ConsentSourceSchema.default("web"),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const owner = ownerOf(c);
      try {
        const row = await consent.revoke({
          userId: owner,
          purpose: body.purpose,
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
          source: body.source,
          ip_hash: ipOf(c) ? await fingerprint(ipOf(c)) : "",
        });
        return c.json({ data: { id: row.id, at: row.timestamp, purpose: row.purpose, action: row.action } });
      } catch (err) {
        if (err instanceof ConsentNotRevocableError) {
          return c.json(errBody("CONSENT_NOT_REVOCABLE", err.message, c, { purpose: err.purpose }), 409);
        }
        throw err;
      }
    },
  );

  router.delete(
    "/consent/:purpose",
    zv("param", z.object({ purpose: ConsentPurposeSchema })),
    async (c) => {
      const { purpose } = c.req.valid("param");
      const owner = ownerOf(c);
      try {
        const row = await consent.revoke({ userId: owner, purpose, source: "web" });
        return c.json({ data: { ok: true, purpose, revokedAt: row.timestamp } });
      } catch (err) {
        if (err instanceof ConsentNotRevocableError) {
          return c.json(
            errBody(
              "CONSENT_WOULD_CANCEL",
              "Revoking this purpose would cancel any active booking. Confirm via the web flow.",
              c,
              { purpose },
            ),
            409,
          );
        }
        throw err;
      }
    },
  );

  // ---------- erasure -------------------------------------------------------
  router.post(
    "/erasure",
    zv("json", z.object({ scope: z.enum(["all", "pii-only"]).default("all") })),
    async (c) => {
      const body = c.req.valid("json");
      const owner = ownerOf(c);
      const idempotencyKey = c.req.header("idempotency-key") ?? undefined;
      const req = await erasure.requestErasure({
        userId: owner,
        scope: body.scope,
        ...(idempotencyKey !== undefined ? { requestId: idempotencyKey } : {}),
      });
      if (req.status === "pending") {
        await erasure.executeErasure(req.requestId);
      }
      const fresh = await erasure.getReceipt(req.requestId);
      return c.json({ data: fresh ?? req }, 202);
    },
  );

  router.get(
    "/erasure/:tombstoneId",
    zv("param", z.object({ tombstoneId: z.string().min(8).max(128) })),
    async (c) => {
      const { tombstoneId } = c.req.valid("param");
      const r = await erasure.getReceipt(tombstoneId);
      if (!r) return c.json(errBody("NOT_FOUND", "Erasure receipt not found", c), 404);
      return c.json({ data: r });
    },
  );

  router.get("/erasure", async (c) => {
    const owner = ownerOf(c);
    const list = await erasure.listForUser(owner);
    return c.json({ data: { items: list } });
  });

  // ---------- data export (DPDP/GDPR portability) ---------------------------
  router.get("/data-export", async (c) => {
    const owner = ownerOf(c);
    const consents = await consent.getConsentLog(owner);
    const erasureReceipts = await erasure.listForUser(owner);
    return c.json({
      data: {
        ownerId: owner,
        exportedAt: new Date().toISOString(),
        consents,
        erasureReceipts,
        legalBasis: "DPDP s.11 (right to access) + GDPR Art. 20 (portability)",
      },
    });
  });

  return router;
}

// Tiny IP fingerprint — we never store the raw IP. Real prod uses HMAC with
// a per-process salt rotated through KMS; here we use the same approach
// from @vsbs/compliance.
async function fingerprint(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out.slice(0, 32);
}

export type { ConsentPurpose };

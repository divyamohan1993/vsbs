// =============================================================================
// Autonomy routes — challenge/sign/action/revoke lifecycle, takeover
// ladder evaluation, and capability v2 resolver. All boundaries Zod-checked.
//
// Defense-in-depth: the outer server applies rate limit, body size cap,
// structured logging, secure headers, and request id. This router adds
// Zod validation on every POST body.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";
import { errBody, type AppEnv } from "../middleware/security.js";
import type { Env } from "../env.js";

import {
  CommandGrantSchema,
  AutonomyActionSchema,
  GrantScopeSchema,
  type AutonomyAction,
} from "@vsbs/shared";
import {
  CommandGrantChallengeSchema,
  CommandGrantTemplateSchema,
  makeSimGrantVerifier,
  makeLiveGrantVerifier,
  witnessSign,
} from "@vsbs/shared/commandgrant-lifecycle";
import {
  escalateTakeover,
  TakeoverRungSchema,
} from "@vsbs/shared/takeover";
import {
  resolveAutonomyCapabilityV2,
  SEED_OEM_REGISTRY,
  SEED_GEOFENCE_CATALOGUE,
  OemCapabilityRegistrySchema,
  GeofenceCatalogueSchema,
} from "@vsbs/shared/autonomy-registry";
import {
  MemoryGrantChainStore,
  appendKind,
  appendRevocation,
} from "../adapters/autonomy/grant-chain.js";
import { MercedesBoschAvpAdapter } from "../adapters/autonomy/avp/mercedes-bosch.js";

const WITNESS_ID = "vsbs-concierge";

export function buildAutonomyRouter(env: Env) {
  const router = new Hono<AppEnv>();
  const store = new MemoryGrantChainStore();
  const verifier =
    env.MERCEDES_IPP_MODE === "live" ? makeLiveGrantVerifier() : makeSimGrantVerifier();

  const avpAdapter = new MercedesBoschAvpAdapter({
    mode: env.MERCEDES_IPP_MODE,
    store,
    ...(env.MERCEDES_IPP_MODE === "live"
      ? { base: env.MERCEDES_IPP_BASE, token: env.MERCEDES_IPP_TOKEN }
      : {}),
  });

  const guard = (c: Parameters<typeof errBody>[2]): Response | null => {
    if (!env.AUTONOMY_ENABLED) {
      return new Response(
        JSON.stringify(errBody("AUTONOMY_DISABLED", "Autonomy is disabled on this server", c)),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    return null;
  };

  // ---------- Challenge ----------

  const ChallengeBodySchema = z.object({
    grantTemplate: CommandGrantTemplateSchema,
    ttlSeconds: z.number().int().positive().max(600).default(300),
  });

  router.post("/grant/challenge", zv("json", ChallengeBodySchema), async (c) => {
    const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
    if (blocked) return blocked;
    const { grantTemplate, ttlSeconds } = c.req.valid("json");
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonceB64u = btoa(String.fromCharCode(...nonceBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const challenge = CommandGrantChallengeSchema.parse({
      challengeId: crypto.randomUUID(),
      nonceB64u,
      issuedAt: new Date().toISOString(),
      ttlSeconds,
      grantTemplate,
    });
    return c.json({ data: challenge }, 201);
  });

  // ---------- Sign (verify + witness + persist) ----------

  router.post("/grant/sign", zv("json", CommandGrantSchema), async (c) => {
    const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
    if (blocked) return blocked;
    const grant = c.req.valid("json");
    const ok = await verifier.verifyOwnerSignature(grant, null);
    if (!ok) {
      return c.json(errBody("GRANT_SIG_INVALID", "Owner signature verification failed", c), 400);
    }
    const { mergedGrant } = await witnessSign(grant, WITNESS_ID);
    const accepted = await avpAdapter.acceptGrant(mergedGrant);
    return c.json({ data: { grant: mergedGrant, action: accepted } }, 201);
  });

  // ---------- Append arbitrary action ----------

  const ActionBodySchema = z.object({
    kind: AutonomyActionSchema.shape.kind,
    extra: z.unknown().optional(),
  });

  router.post(
    "/grant/:id/action",
    zv("param", z.object({ id: z.string().uuid() })),
    zv("json", ActionBodySchema),
    async (c) => {
      const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
      if (blocked) return blocked;
      const { id } = c.req.valid("param");
      const { kind, extra } = c.req.valid("json");
      if (!store.getGrant(id)) {
        return c.json(errBody("GRANT_NOT_FOUND", "No grant with that id", c), 404);
      }
      let action: AutonomyAction;
      try {
        action = await appendKind(store, id, kind, extra);
      } catch (err) {
        return c.json(errBody("CHAIN_APPEND_FAILED", String(err), c), 500);
      }
      return c.json({ data: action }, 201);
    },
  );

  // ---------- Revoke ----------

  router.post(
    "/grant/:id/revoke",
    zv("param", z.object({ id: z.string().uuid() })),
    zv("json", z.object({ reason: z.string().min(1).max(500) })),
    async (c) => {
      const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
      if (blocked) return blocked;
      const { id } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      if (!store.getGrant(id)) {
        return c.json(errBody("GRANT_NOT_FOUND", "No grant with that id", c), 404);
      }
      const action = await appendRevocation(store, id, reason);
      try {
        await avpAdapter.revokeGrant(id, reason);
      } catch {
        // Sim/live side effect failure does not invalidate the on-chain revocation.
      }
      return c.json({ data: action }, 201);
    },
  );

  // ---------- Perform scope (adapter passthrough) ----------

  router.post(
    "/grant/:id/perform",
    zv("param", z.object({ id: z.string().uuid() })),
    zv("json", z.object({ scope: GrantScopeSchema })),
    async (c) => {
      const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
      if (blocked) return blocked;
      const { id } = c.req.valid("param");
      const { scope } = c.req.valid("json");
      if (!store.getGrant(id)) {
        return c.json(errBody("GRANT_NOT_FOUND", "No grant with that id", c), 404);
      }
      const result = await avpAdapter.performScope({ grantId: id, scope });
      return c.json({ data: result });
    },
  );

  // ---------- Takeover ladder evaluation ----------

  const TakeoverBodySchema = z.object({
    currentRung: TakeoverRungSchema,
    elapsedMs: z.number().int().nonnegative(),
    ackReceived: z.boolean().default(false),
  });

  router.post("/takeover", zv("json", TakeoverBodySchema), (c) => {
    const { currentRung, elapsedMs, ackReceived } = c.req.valid("json");
    const result = escalateTakeover(currentRung, elapsedMs, ackReceived);
    return c.json({ data: result });
  });

  // ---------- Capability v2 ----------

  const CapabilityV2Body = z.object({
    oemId: z.string().min(1),
    vehicle: z.object({
      make: z.string(),
      model: z.string(),
      year: z.number().int(),
      yearsSupported: z.array(z.number().int()),
      autonomyHw: z.array(z.string()).optional(),
    }),
    destinationProvider: z.string(),
    providersSupported: z.array(z.string()),
    destinationPoint: z.object({ lat: z.number(), lng: z.number() }),
    owner: z.object({
      autonomyConsentGranted: z.boolean(),
      insuranceAllowsAutonomy: z.boolean(),
    }),
    registry: OemCapabilityRegistrySchema.optional(),
    catalogue: GeofenceCatalogueSchema.optional(),
  });

  router.post("/capability/v2", zv("json", CapabilityV2Body), (c) => {
    const body = c.req.valid("json");
    const registry = body.registry ?? SEED_OEM_REGISTRY;
    const catalogue = body.catalogue ?? SEED_GEOFENCE_CATALOGUE;
    const result = resolveAutonomyCapabilityV2(
      {
        oemId: body.oemId,
        vehicle: body.vehicle,
        destinationProvider: body.destinationProvider,
        providersSupported: body.providersSupported,
        destinationPoint: body.destinationPoint,
        owner: body.owner,
      },
      registry,
      catalogue,
    );
    return c.json({ data: result });
  });

  return router;
}

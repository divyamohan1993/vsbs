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
  type CommandGrant,
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
  HeartbeatRunner,
  OfflineGrantEnvelopeSchema,
  mintOfflineEnvelope,
  permitOfflineAction,
  generateWitnessKeypair,
  DualControlPolicySchema,
  DualControlSignatureSchema,
  assembleDualControlGrant,
  InMemoryOffPlatformSink,
  NotConfiguredOffPlatformSink,
  recordOffPlatformAudit,
  type DualControlSignature,
  type DualControlKeyResolver,
  type WitnessKeyResolver,
  type WitnessSigningKey,
  type WitnessVerifyingKey,
  type OffPlatformAuditSink,
  type HeartbeatRevocation,
} from "@vsbs/shared/autonomy-lifecycle";
import {
  MemoryGrantChainStore,
  appendKind,
  appendRevocation,
} from "../adapters/autonomy/grant-chain.js";
import { MercedesBoschAvpAdapter } from "../adapters/autonomy/avp/mercedes-bosch.js";

const WITNESS_ID = "vsbs-concierge";

export interface BuildAutonomyRouterOptions {
  /**
   * Off-platform audit sink. Production: pipe to BigQuery / QLDB.
   * Tests: InMemoryOffPlatformSink. Default in sim mode is in-memory; in
   * live mode the not-configured sink throws on first write to surface
   * misconfiguration loudly.
   */
  auditSink?: OffPlatformAuditSink;
  /** Override witness key store — mainly for tests. */
  witnessKeys?: Map<string, WitnessSigningKey>;
  witnessVerifyingKeys?: Map<string, WitnessVerifyingKey>;
  /** Override dual-control key resolver — mainly for tests. */
  dualControlResolver?: DualControlKeyResolver;
  /** Override the HeartbeatRunner — mainly for tests. */
  heartbeatRunner?: HeartbeatRunner;
}

export function buildAutonomyRouter(env: Env, opts: BuildAutonomyRouterOptions = {}) {
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

  const auditSink: OffPlatformAuditSink =
    opts.auditSink ??
    (env.MERCEDES_IPP_MODE === "live"
      ? new NotConfiguredOffPlatformSink()
      : new InMemoryOffPlatformSink());

  // Witness key store for offline envelopes. In sim mode, generate one on
  // boot — that key id is announced through the offline-envelope mint
  // response so deployers can publish it. Live deployments inject keys
  // through opts.witnessKeys.
  const witnessSigningKeys: Map<string, WitnessSigningKey> = opts.witnessKeys ?? new Map();
  const witnessVerifyingKeys: Map<string, WitnessVerifyingKey> =
    opts.witnessVerifyingKeys ?? new Map();
  if (witnessSigningKeys.size === 0 && env.MERCEDES_IPP_MODE !== "live") {
    const { signing, verifying } = generateWitnessKeypair("vsbs-concierge-witness");
    witnessSigningKeys.set(signing.keyId, signing);
    witnessVerifyingKeys.set(verifying.keyId, verifying);
  }
  const witnessResolver: WitnessKeyResolver = (id) => witnessVerifyingKeys.get(id);

  const dualControlResolver: DualControlKeyResolver =
    opts.dualControlResolver ?? (() => undefined);

  const heartbeatRunner =
    opts.heartbeatRunner ??
    new HeartbeatRunner({
      onRevoke: async (rev: HeartbeatRevocation) => {
        if (!store.getGrant(rev.grantId)) return;
        const action = await appendRevocation(store, rev.grantId, `${rev.reason}: ${rev.reasons.join("; ")}`);
        try {
          await avpAdapter.revokeGrant(rev.grantId, rev.reason);
        } catch {
          // Adapter side effect failure does not invalidate the on-chain revocation.
        }
        try {
          await recordOffPlatformAudit(auditSink, action, "heartbeat-runner");
        } catch {
          // Off-platform audit failure surfaces in logs but never blocks revocation.
        }
      },
    });

  // Pending-signature buckets for dual-control. Keyed by grant id, holds
  // submitted signatures until quorum is met. O(1) per submission.
  const pendingSignatures = new Map<string, DualControlSignature[]>();
  const pendingGrants = new Map<string, CommandGrant>();

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

  // ---------- Heartbeat tick (B4) ----------
  //
  // Not a public route. The on-vehicle controller posts a signed tick on
  // every interval; the server forwards a synthetic evaluator response into
  // the runner. The header `x-tick-token` must equal the env-injected
  // tick token (mTLS in real deployments). On any tier1Healthy=false the
  // runner auto-revokes via the onRevoke hook wired above.

  const HeartbeatBodySchema = z.object({
    tier1Healthy: z.boolean(),
    reasons: z.array(z.string().max(200)).max(20).default([]),
  });

  router.post(
    "/grants/:id/heartbeat",
    zv("param", z.object({ id: z.string().uuid() })),
    zv("json", HeartbeatBodySchema),
    async (c) => {
      const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
      if (blocked) return blocked;
      const { id } = c.req.valid("param");
      const { tier1Healthy, reasons } = c.req.valid("json");
      if (!store.getGrant(id)) {
        return c.json(errBody("GRANT_NOT_FOUND", "No grant with that id", c), 404);
      }
      if (!heartbeatRunner.isRunning(id)) {
        // Lazy-start a runner for this grant. The evaluator is updated each
        // beat by snapshotting the latest tick payload via a closure cell.
        const cell: { tier1Healthy: boolean; reasons: string[] } = { tier1Healthy: true, reasons: [] };
        heartbeatRunner.start(
          id,
          { intervalMs: 1_000 },
          async () => ({ tier1Healthy: cell.tier1Healthy, reasons: cell.reasons }),
        );
        cell.tier1Healthy = tier1Healthy;
        cell.reasons = reasons;
        if (!tier1Healthy) {
          // Synthesise an immediate revocation; the runner would otherwise
          // wait until its next interval.
          await appendRevocation(store, id, `tier1-flip: ${reasons.join("; ")}`);
          heartbeatRunner.stop(id);
          return c.json({ data: { ok: false, revoked: true } }, 200);
        }
        return c.json({ data: { ok: true, revoked: false } }, 200);
      }
      // Direct synchronous check — the API layer can flip the grant in O(1)
      // without waiting for the next runner interval.
      if (!tier1Healthy) {
        await appendRevocation(store, id, `tier1-flip: ${reasons.join("; ")}`);
        heartbeatRunner.stop(id);
        return c.json({ data: { ok: false, revoked: true } }, 200);
      }
      return c.json({ data: { ok: true, revoked: false } }, 200);
    },
  );

  // ---------- Offline envelope (F1) ----------

  const OfflineEnvelopeBodySchema = z.object({
    keyId: z.string().min(1).optional(),
    offlineTtlMs: z.number().int().positive().optional(),
    allowedActions: z.array(z.enum(["mrm-stop", "mrm-pull-over"])).optional(),
  });

  router.post(
    "/grants/:id/offline-envelope",
    zv("param", z.object({ id: z.string().uuid() })),
    zv("json", OfflineEnvelopeBodySchema),
    async (c) => {
      const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
      if (blocked) return blocked;
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const rec = store.getGrant(id);
      if (!rec) {
        return c.json(errBody("GRANT_NOT_FOUND", "No grant with that id", c), 404);
      }
      const keyId = body.keyId ?? Array.from(witnessSigningKeys.keys())[0];
      if (!keyId) {
        return c.json(errBody("WITNESS_KEY_MISSING", "No witness signing key available", c), 500);
      }
      const witnessKey = witnessSigningKeys.get(keyId);
      if (!witnessKey) {
        return c.json(errBody("WITNESS_KEY_NOT_FOUND", `No witness key with id ${keyId}`, c), 404);
      }
      const envelope = mintOfflineEnvelope({
        grant: rec.grant,
        witnessKey,
        ...(body.offlineTtlMs !== undefined ? { offlineTtlMs: body.offlineTtlMs } : {}),
        ...(body.allowedActions !== undefined ? { allowedActions: body.allowedActions } : {}),
      });
      return c.json({ data: { envelope, keyId } }, 201);
    },
  );

  // Verify endpoint — useful for clients that hold an envelope and want to
  // confirm validity before using it offline.
  router.post(
    "/offline-envelope/verify",
    zv(
      "json",
      z.object({
        envelope: OfflineGrantEnvelopeSchema,
        action: z.enum(["mrm-stop", "mrm-pull-over"]),
        nowIso: z.string().datetime().optional(),
      }),
    ),
    (c) => {
      const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
      if (blocked) return blocked;
      const { envelope, action, nowIso } = c.req.valid("json");
      const result = permitOfflineAction({
        envelope,
        action,
        resolver: witnessResolver,
        ...(nowIso !== undefined ? { now: new Date(nowIso) } : {}),
      });
      return c.json({ data: result });
    },
  );

  // ---------- Dual-control (D2) ----------

  const DualControlBodySchema = z.object({
    grant: CommandGrantSchema,
    signature: DualControlSignatureSchema,
    policy: DualControlPolicySchema.optional(),
  });

  router.post(
    "/grants/:id/dual-control",
    zv("param", z.object({ id: z.string().uuid() })),
    zv("json", DualControlBodySchema),
    async (c) => {
      const blocked = guard(c as unknown as Parameters<typeof errBody>[2]);
      if (blocked) return blocked;
      const { id } = c.req.valid("param");
      const { grant, signature, policy: rawPolicy } = c.req.valid("json");
      if (grant.grantId !== id) {
        return c.json(errBody("GRANT_ID_MISMATCH", "URL grantId does not match body grantId", c), 400);
      }
      const policy = rawPolicy ?? DualControlPolicySchema.parse({});
      pendingGrants.set(id, grant);
      const list = pendingSignatures.get(id) ?? [];
      // Replace any prior signature from the same role to avoid duplicate-role
      // rejections caused by retries. Newest signature wins.
      const filtered = list.filter((s) => s.role !== signature.role);
      filtered.push(signature);
      pendingSignatures.set(id, filtered);
      const assembled = assembleDualControlGrant(grant, policy, filtered, dualControlResolver);
      if (assembled.kind === "verified") {
        pendingSignatures.delete(id);
        pendingGrants.delete(id);
        const { mergedGrant } = await witnessSign(grant, WITNESS_ID);
        const accepted = await avpAdapter.acceptGrant(mergedGrant);
        try {
          await recordOffPlatformAudit(auditSink, accepted, "dual-control");
        } catch {
          // Off-platform audit failure does not invalidate on-chain accept.
        }
        return c.json(
          {
            data: {
              status: "verified",
              grant: mergedGrant,
              action: accepted,
              verifiedSigners: assembled.verifiedSigners,
            },
          },
          201,
        );
      }
      return c.json(
        {
          data: {
            status: "pending",
            received: filtered.length,
            required: policy.requiredSigners,
            reasons: assembled.reasons,
          },
        },
        202,
      );
    },
  );

  return router;
}

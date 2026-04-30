import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { buildAutonomyRouter } from "./autonomy.js";
import { requestId, type AppEnv } from "../middleware/security.js";
import type { Env } from "../env.js";
import { CommandGrantSchema, type CommandGrant } from "@vsbs/shared";
import {
  simSignOwner,
  canonicalGrantBytes,
} from "@vsbs/shared/commandgrant-lifecycle";
import {
  generateWitnessKeypair,
  type WitnessSigningKey,
  type WitnessVerifyingKey,
  type DualControlKeyResolver,
  type DualControlPublicKey,
} from "@vsbs/shared/autonomy-lifecycle";

const baseEnv: Env = {
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  APP_DEMO_MODE: true,
  APP_REGION: "asia-south1",
  APP_REGIONS: "asia-south1",
  APP_REGION_RUNTIME: "asia-south1",
  APP_REGION_EU_BLOCK: false,
  IDENTITY_PLATFORM_SIGNING_KEY: "test-signing-key-1234",
  ANTHROPIC_MODEL_OPUS: "claude-opus-4-6",
  ANTHROPIC_MODEL_HAIKU: "claude-haiku-4-5-20251001",
  ANTHROPIC_MANAGED_AGENTS_BETA: "managed-agents-2026-04-01",
  GOOGLE_CLOUD_PROJECT: "dmjone",
  GOOGLE_CLOUD_REGION: "asia-south1",
  GOOGLE_CLOUD_REGION_SECONDARY: "us-central1",
  VERTEX_AI_LOCATION: "asia-south1",
  VERTEX_GEMINI_MODEL: "gemini-3-pro",
  GEMINI_LIVE_MODEL: "gemini-live-2.5-flash-native-audio",
  MAPS_MODE: "sim",
  NHTSA_VPIC_BASE: "https://vpic.nhtsa.dot.gov/api/vehicles",
  AUTH_MODE: "sim",
  AUTH_OTP_LENGTH: 6,
  AUTH_OTP_TTL_SECONDS: 300,
  AUTH_OTP_MAX_ATTEMPTS: 5,
  AUTH_OTP_LOCKOUT_SECONDS: 900,
  PAYMENT_MODE: "sim",
  PAYMENT_PROVIDER: "razorpay",
  SENSORS_MODE: "mixed",
  SMARTCAR_MODE: "sim",
  OBD_DONGLE_MODE: "sim",
  AUTONOMY_ENABLED: true,
  AUTONOMY_MODE: "sim",
  AUTONOMY_DEFAULT_AUTOPAY_CAP_INR: 0,
  AUTONOMY_DEFAULT_AUTOPAY_CAP_USD: 0,
  MERCEDES_IPP_MODE: "sim",
  LLM_PROFILE: "sim",
};

const baseTemplate = {
  grantId: "77777777-7777-4777-8777-777777777777",
  vehicleId: "veh-rt-1",
  granteeSvcCenterId: "svc-rt",
  tier: "A-AVP" as const,
  scopes: ["drive-to-bay" as const],
  notBefore: "2026-04-15T10:00:00.000Z",
  notAfter: "2026-04-15T12:00:00.000Z",
  geofence: { lat: 48.78, lng: 9.18, radiusMeters: 400 },
  maxAutoPayInr: 5000,
  mustNotify: ["start" as const],
  ownerSigAlg: "ed25519" as const,
};

async function mintGrant(): Promise<CommandGrant> {
  const sig = await simSignOwner(baseTemplate);
  return CommandGrantSchema.parse({ ...baseTemplate, ownerSignatureB64: sig, witnessSignaturesB64: {} });
}

async function buildAppWithGrant(witnessKeys?: {
  signing: Map<string, WitnessSigningKey>;
  verifying: Map<string, WitnessVerifyingKey>;
}, dualControlResolver?: DualControlKeyResolver) {
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  const router = buildAutonomyRouter(baseEnv, {
    ...(witnessKeys ? { witnessKeys: witnessKeys.signing, witnessVerifyingKeys: witnessKeys.verifying } : {}),
    ...(dualControlResolver ? { dualControlResolver } : {}),
  });
  app.route("/v1/autonomy", router);
  // Pre-mint a grant via the existing /grant/sign route so the chain exists.
  const grant = await mintGrant();
  const signResp = await app.request("/v1/autonomy/grant/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(grant),
  });
  expect(signResp.status).toBe(201);
  return { app, grant };
}

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

describe("autonomy heartbeat route", () => {
  it("healthy beat returns ok+not-revoked", async () => {
    const { app, grant } = await buildAppWithGrant();
    const res = await app.request(`/v1/autonomy/grants/${grant.grantId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier1Healthy: true, reasons: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(body.data.revoked).toBe(false);
  });

  it("tier1Healthy=false revokes immediately", async () => {
    const { app, grant } = await buildAppWithGrant();
    // First a healthy beat to start the runner.
    await app.request(`/v1/autonomy/grants/${grant.grantId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier1Healthy: true, reasons: [] }),
    });
    const res = await app.request(`/v1/autonomy/grants/${grant.grantId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier1Healthy: false, reasons: ["brake-fault"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revoked).toBe(true);
  });

  it("404 for unknown grant id", async () => {
    const { app } = await buildAppWithGrant();
    const ghostId = "99999999-9999-4999-8999-999999999999";
    const res = await app.request(`/v1/autonomy/grants/${ghostId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier1Healthy: true, reasons: [] }),
    });
    expect(res.status).toBe(404);
  });
});

describe("autonomy offline-envelope route", () => {
  it("mints + verify round trip", async () => {
    const { app, grant } = await buildAppWithGrant();
    const mint = await app.request(`/v1/autonomy/grants/${grant.grantId}/offline-envelope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(mint.status).toBe(201);
    const mintBody = await mint.json();
    const envelope = mintBody.data.envelope;
    expect(envelope.allowedActions).toContain("mrm-stop");

    const verifyRes = await app.request(`/v1/autonomy/offline-envelope/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope, action: "mrm-stop" }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.data.permitted).toBe(true);
  });

  it("rejects non-MRM action via verify", async () => {
    const { app, grant } = await buildAppWithGrant();
    const mint = await app.request(`/v1/autonomy/grants/${grant.grantId}/offline-envelope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const envelope = (await mint.json()).data.envelope;
    const verifyRes = await app.request(`/v1/autonomy/offline-envelope/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope, action: "drive-to-bay" }),
    });
    // Zod rejects the action enum at the boundary -> 400.
    expect(verifyRes.status).toBe(400);
  });
});

describe("autonomy dual-control route", () => {
  it("first signature returns pending; quorum mints grant", async () => {
    // Build keys.
    const ownerKp = ml_dsa65.keygen();
    const opsKp = ml_dsa65.keygen();
    const owner: { keyId: string; secretKey: Uint8Array; publicKey: Uint8Array } = {
      keyId: "kp-owner",
      secretKey: new Uint8Array(ownerKp.secretKey),
      publicKey: new Uint8Array(ownerKp.publicKey),
    };
    const ops: { keyId: string; secretKey: Uint8Array; publicKey: Uint8Array } = {
      keyId: "kp-ops",
      secretKey: new Uint8Array(opsKp.secretKey),
      publicKey: new Uint8Array(opsKp.publicKey),
    };
    const resolver: DualControlKeyResolver = (role, keyId): DualControlPublicKey | undefined => {
      if (role === "owner-passkey" && keyId === owner.keyId) {
        return { role, keyId, publicKey: owner.publicKey };
      }
      if (role === "ops-witness" && keyId === ops.keyId) {
        return { role, keyId, publicKey: ops.publicKey };
      }
      return undefined;
    };
    const { app, grant } = await buildAppWithGrant(undefined, resolver);

    const bytes = canonicalGrantBytes(grant);
    const sigOwner = ml_dsa65.sign(bytes, owner.secretKey);
    const sigOps = ml_dsa65.sign(bytes, ops.secretKey);

    const t0 = "2026-04-15T10:30:00.000Z";
    const t1 = "2026-04-15T10:30:01.000Z";

    const r1 = await app.request(`/v1/autonomy/grants/${grant.grantId}/dual-control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant,
        signature: {
          role: "owner-passkey",
          keyId: owner.keyId,
          signedAt: t0,
          sigB64: b64Encode(new Uint8Array(sigOwner)),
          alg: "ml-dsa-65",
        },
      }),
    });
    expect(r1.status).toBe(202);
    const b1 = await r1.json();
    expect(b1.data.status).toBe("pending");

    const r2 = await app.request(`/v1/autonomy/grants/${grant.grantId}/dual-control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant,
        signature: {
          role: "ops-witness",
          keyId: ops.keyId,
          signedAt: t1,
          sigB64: b64Encode(new Uint8Array(sigOps)),
          alg: "ml-dsa-65",
        },
      }),
    });
    expect(r2.status).toBe(201);
    const b2 = await r2.json();
    expect(b2.data.status).toBe("verified");
    expect(b2.data.verifiedSigners).toHaveLength(2);
  });

  it("URL grantId mismatch rejects 400", async () => {
    const { app, grant } = await buildAppWithGrant();
    const otherId = "88888888-8888-4888-8888-888888888888";
    const res = await app.request(`/v1/autonomy/grants/${otherId}/dual-control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant,
        signature: {
          role: "owner-passkey",
          keyId: "any",
          signedAt: "2026-04-15T10:30:00.000Z",
          sigB64: "AA==",
          alg: "ml-dsa-65",
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("GRANT_ID_MISMATCH");
  });
});

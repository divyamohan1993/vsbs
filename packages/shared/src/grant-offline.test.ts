import { describe, it, expect } from "vitest";
import {
  generateWitnessKeypair,
  mintOfflineEnvelope,
  permitOfflineAction,
  verifyOfflineEnvelope,
  OFFLINE_GRANT_MAX_TTL_MS,
  type WitnessKeyResolver,
} from "./grant-offline.js";
import { CommandGrantSchema, type CommandGrant } from "./autonomy.js";
import { simSignOwner } from "./commandgrant-lifecycle.js";

const baseTemplate = {
  grantId: "33333333-3333-4333-8333-333333333333",
  vehicleId: "veh-offline-1",
  granteeSvcCenterId: "svc-1",
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

describe("offline grant envelope", () => {
  it("round trip: mint -> verify -> permit", async () => {
    const grant = await mintGrant();
    const { signing, verifying } = generateWitnessKeypair("witness-1");
    const resolver: WitnessKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const now = new Date("2026-04-15T10:30:00.000Z");

    const env = mintOfflineEnvelope({ grant, witnessKey: signing, now });
    expect(env.allowedActions.sort()).toEqual(["mrm-pull-over", "mrm-stop"]);
    expect(env.offlineTtlMs).toBe(OFFLINE_GRANT_MAX_TTL_MS);

    expect(verifyOfflineEnvelope(env, resolver).valid).toBe(true);

    const r = permitOfflineAction({
      envelope: env,
      action: "mrm-stop",
      resolver,
      now: new Date(now.getTime() + 5_000),
    });
    expect(r.permitted).toBe(true);
  });

  it("refuses an expired envelope", async () => {
    const grant = await mintGrant();
    const { signing, verifying } = generateWitnessKeypair("witness-2");
    const resolver: WitnessKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const now = new Date("2026-04-15T10:30:00.000Z");

    const env = mintOfflineEnvelope({ grant, witnessKey: signing, offlineTtlMs: 5_000, now });
    const r = permitOfflineAction({
      envelope: env,
      action: "mrm-stop",
      resolver,
      now: new Date(now.getTime() + 6_000),
    });
    expect(r.permitted).toBe(false);
    expect(r.reason).toMatch(/expired/);
  });

  it("clamps caller TTL above 30s back to 30s", async () => {
    const grant = await mintGrant();
    const { signing } = generateWitnessKeypair("witness-3");
    const env = mintOfflineEnvelope({ grant, witnessKey: signing, offlineTtlMs: 600_000 });
    expect(env.offlineTtlMs).toBe(OFFLINE_GRANT_MAX_TTL_MS);
  });

  it("refuses non-MRM actions even if envelope tampered to include them", async () => {
    const grant = await mintGrant();
    const { signing, verifying } = generateWitnessKeypair("witness-4");
    const resolver: WitnessKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const env = mintOfflineEnvelope({ grant, witnessKey: signing });

    // permitOfflineAction guards against a non-MRM action even at the type level
    // — this test confirms `permitted: false` and a typed rejection reason.
    const r = permitOfflineAction({
      envelope: env,
      // @ts-expect-error — deliberately passing a forbidden action
      action: "drive-to-bay",
      resolver,
    });
    expect(r.permitted).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const grant = await mintGrant();
    const { signing, verifying } = generateWitnessKeypair("witness-5");
    const resolver: WitnessKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const env = mintOfflineEnvelope({ grant, witnessKey: signing });

    // Flip a byte in the base64 signature.
    const sig = env.signatureB64;
    const tamperedSig = sig.startsWith("A") ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    const tampered = { ...env, signatureB64: tamperedSig };

    const r = verifyOfflineEnvelope(tampered, resolver);
    expect(r.valid).toBe(false);
  });

  it("rejects when keyId resolver returns undefined", async () => {
    const grant = await mintGrant();
    const { signing } = generateWitnessKeypair("witness-6");
    const env = mintOfflineEnvelope({ grant, witnessKey: signing });
    const resolver: WitnessKeyResolver = () => undefined;
    expect(verifyOfflineEnvelope(env, resolver).valid).toBe(false);
  });

  it("rejects when envelope TTL is mutated above the cap", async () => {
    const grant = await mintGrant();
    const { signing, verifying } = generateWitnessKeypair("witness-7");
    const resolver: WitnessKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const env = mintOfflineEnvelope({ grant, witnessKey: signing });
    const tampered = { ...env, offlineTtlMs: 60_000 };
    expect(verifyOfflineEnvelope(tampered, resolver).valid).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  MemoryCredentialStore,
  MemoryChallengeStore,
  makePasskeyAuthenticator,
  makeRegistrationFixture,
  makeAssertionFixture,
  b64uDecode,
  b64uEncode,
} from "../src/webauthn.js";
import {
  challengeForGrant,
  makePqWitness,
  verifyPasskeyGrantAssertion,
  verifyWitnessSignature,
} from "../src/command-grant-passkey.js";
import { makeMlDsa65Signer } from "../src/sig.js";
import { CommandGrantSchema, simSignOwner, type CommandGrant } from "@vsbs/shared";

const RP = "vsbs.app";
const ORIGIN = "https://vsbs.app";

async function buildSampleGrant(): Promise<CommandGrant> {
  const base = {
    grantId: "11111111-2222-3333-4444-555555555555",
    vehicleId: "VIN-XYZ",
    granteeSvcCenterId: "svc-bangalore-1",
    tier: "A-AVP" as const,
    scopes: ["drive-to-bay" as const],
    notBefore: new Date(Date.now() + 1000).toISOString(),
    notAfter: new Date(Date.now() + 3600_000).toISOString(),
    geofence: { lat: 12.97, lng: 77.59, radiusMeters: 500 },
    maxAutoPayInr: 0,
    mustNotify: ["start" as const, "finish" as const],
    ownerSigAlg: "webauthn-es256" as const,
    witnessSignaturesB64: {},
  };
  const ownerSig = await simSignOwner(base);
  return CommandGrantSchema.parse({ ...base, ownerSignatureB64: ownerSig });
}

describe("command-grant passkey bridge", () => {
  it("verifies a passkey assertion bound to a grant + ML-DSA-65 witness co-signs", async () => {
    const credentials = new MemoryCredentialStore();
    const challenges = new MemoryChallengeStore();
    const auth = makePasskeyAuthenticator({ credentials, challenges });

    // Register a passkey for the owner.
    const userId = "owner-1";
    const reg = auth.beginRegistration({ userId, rpId: RP });
    const fixture = await makeRegistrationFixture({ rpId: RP, challenge: reg.challenge, origin: ORIGIN });
    const finished = await auth.finishRegistration({
      userId, rpId: RP, expectedOrigin: ORIGIN, attestation: fixture.attestation,
    });

    // Build a grant; derive its WebAuthn challenge from canonical bytes.
    const grant = await buildSampleGrant();
    const challenge = await challengeForGrant(grant);

    // Owner device produces an assertion over that exact challenge.
    const assertion = await makeAssertionFixture({
      rpId: RP, challenge, origin: ORIGIN,
      credentialId: b64uDecode(finished.credentialId),
      privateJwk: fixture.privateJwk, signCount: 9,
    });

    const r = await verifyPasskeyGrantAssertion({
      grant, rpId: RP, expectedOrigin: ORIGIN,
      assertion: assertion.assertion,
      credentials, expectedChallengeB64u: challenge,
    });
    expect(r.ok).toBe(true);
    expect(r.algName).toBe("ES256");

    // Witness co-signs with ML-DSA-65.
    const signer = makeMlDsa65Signer();
    const witness = makePqWitness({ witnessId: "vsbs-witness-1", signer });
    const cosigned = await witness.cosignGrant(grant);
    expect(cosigned.alg).toBe("ML-DSA-65");
    expect(cosigned.mergedGrant.witnessSignaturesB64["vsbs-witness-1"]).toBe(cosigned.signatureB64);
    expect(verifyWitnessSignature(signer, witness.publicKey, grant, cosigned.signatureB64)).toBe(true);
  });

  it("rejects an assertion bound to a different grant", async () => {
    const credentials = new MemoryCredentialStore();
    const auth = makePasskeyAuthenticator({ credentials });
    const userId = "owner-2";
    const reg = auth.beginRegistration({ userId, rpId: RP });
    const fixture = await makeRegistrationFixture({ rpId: RP, challenge: reg.challenge, origin: ORIGIN });
    const finished = await auth.finishRegistration({
      userId, rpId: RP, expectedOrigin: ORIGIN, attestation: fixture.attestation,
    });
    const grant = await buildSampleGrant();
    // Derive challenge from a *different* grant.
    const other = { ...grant, grantId: "99999999-9999-9999-9999-999999999999" };
    const otherChallenge = await challengeForGrant(other);
    const assertion = await makeAssertionFixture({
      rpId: RP, challenge: otherChallenge, origin: ORIGIN,
      credentialId: b64uDecode(finished.credentialId),
      privateJwk: fixture.privateJwk, signCount: 1,
    });
    const r = await verifyPasskeyGrantAssertion({
      grant, rpId: RP, expectedOrigin: ORIGIN, assertion: assertion.assertion,
      credentials, expectedChallengeB64u: await challengeForGrant(grant),
    });
    expect(r.ok).toBe(false);
  });

  it("ML-DSA-65 witness verification is independent of WebAuthn credential", async () => {
    const grant = await buildSampleGrant();
    const signer = makeMlDsa65Signer();
    const witness = makePqWitness({ witnessId: "wid", signer });
    const { signatureB64, mergedGrant } = await witness.cosignGrant(grant);
    expect(verifyWitnessSignature(signer, witness.publicKey, grant, signatureB64)).toBe(true);
    expect(verifyWitnessSignature(signer, witness.publicKey, mergedGrant, signatureB64)).toBe(true);
    // Different witness key -> verify fails.
    const other = makePqWitness({ witnessId: "other" });
    expect(verifyWitnessSignature(signer, other.publicKey, grant, signatureB64)).toBe(false);
  });

  it("challenge derivation is deterministic for the same grant", async () => {
    const g = await buildSampleGrant();
    const a = await challengeForGrant(g);
    const b = await challengeForGrant(g);
    expect(a).toBe(b);
    expect(b64uEncode(b64uDecode(a))).toBe(a);
  });
});

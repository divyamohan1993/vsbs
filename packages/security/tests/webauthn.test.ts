import { describe, it, expect } from "vitest";
import {
  makePasskeyAuthenticator,
  MemoryCredentialStore,
  MemoryChallengeStore,
  makeRegistrationFixture,
  makeAssertionFixture,
  b64uDecode,
} from "../src/webauthn.js";

const RP = "vsbs.app";
const ORIGIN = "https://vsbs.app";

describe("WebAuthn passkey flow (deterministic ES256 fixtures)", () => {
  it("registers and authenticates a credential end to end", async () => {
    const credentials = new MemoryCredentialStore();
    const challenges = new MemoryChallengeStore();
    const auth = makePasskeyAuthenticator({ credentials, challenges });
    const userId = "u-1";

    const reg = auth.beginRegistration({ userId, rpId: RP });
    const fixture = await makeRegistrationFixture({
      rpId: RP,
      challenge: reg.challenge,
      origin: ORIGIN,
    });
    const finished = await auth.finishRegistration({
      userId,
      rpId: RP,
      expectedOrigin: ORIGIN,
      attestation: fixture.attestation,
    });
    expect(finished.algName).toBe("ES256");
    expect(finished.credentialId.length).toBeGreaterThan(0);

    const authn = auth.beginAuthentication({ userId, rpId: RP });
    const assertion = await makeAssertionFixture({
      rpId: RP,
      challenge: authn.challenge,
      origin: ORIGIN,
      credentialId: b64uDecode(finished.credentialId),
      privateJwk: fixture.privateJwk,
      signCount: 1,
    });
    const ok = await auth.finishAuthentication({
      userId,
      rpId: RP,
      expectedOrigin: ORIGIN,
      assertion: assertion.assertion,
    });
    expect(ok).toBe(true);
  });

  it("rejects a finishRegistration with origin mismatch", async () => {
    const auth = makePasskeyAuthenticator();
    const reg = auth.beginRegistration({ userId: "u-2", rpId: RP });
    const fixture = await makeRegistrationFixture({
      rpId: RP, challenge: reg.challenge, origin: "https://attacker.example",
    });
    await expect(
      auth.finishRegistration({
        userId: "u-2", rpId: RP, expectedOrigin: ORIGIN, attestation: fixture.attestation,
      }),
    ).rejects.toThrow(/origin/);
  });

  it("rejects a finishRegistration with rpIdHash mismatch", async () => {
    const auth = makePasskeyAuthenticator();
    const reg = auth.beginRegistration({ userId: "u-3", rpId: "rp-a" });
    // Build the fixture with the wrong rpId so the rpIdHash inside authData fails.
    const fixture = await makeRegistrationFixture({
      rpId: "rp-z", challenge: reg.challenge, origin: ORIGIN,
    });
    await expect(
      auth.finishRegistration({
        userId: "u-3", rpId: "rp-a", expectedOrigin: ORIGIN, attestation: fixture.attestation,
      }),
    ).rejects.toThrow(/rpIdHash/);
  });

  it("rejects assertions with a stale challenge", async () => {
    const auth = makePasskeyAuthenticator();
    const reg = auth.beginRegistration({ userId: "u-4", rpId: RP });
    const fx = await makeRegistrationFixture({ rpId: RP, challenge: reg.challenge, origin: ORIGIN });
    const finished = await auth.finishRegistration({
      userId: "u-4", rpId: RP, expectedOrigin: ORIGIN, attestation: fx.attestation,
    });
    auth.beginAuthentication({ userId: "u-4", rpId: RP });
    const fakeAssertion = await makeAssertionFixture({
      rpId: RP, challenge: "this-was-not-issued", origin: ORIGIN,
      credentialId: b64uDecode(finished.credentialId),
      privateJwk: fx.privateJwk, signCount: 1,
    });
    const ok = await auth.finishAuthentication({
      userId: "u-4", rpId: RP, expectedOrigin: ORIGIN, assertion: fakeAssertion.assertion,
    });
    expect(ok).toBe(false);
  });

  it("rejects assertions where the signCount regresses", async () => {
    const credentials = new MemoryCredentialStore();
    const auth = makePasskeyAuthenticator({ credentials });
    const reg = auth.beginRegistration({ userId: "u-5", rpId: RP });
    const fx = await makeRegistrationFixture({
      rpId: RP, challenge: reg.challenge, origin: ORIGIN, signCount: 5,
    });
    const finished = await auth.finishRegistration({
      userId: "u-5", rpId: RP, expectedOrigin: ORIGIN, attestation: fx.attestation,
    });
    const a1 = auth.beginAuthentication({ userId: "u-5", rpId: RP });
    const sig1 = await makeAssertionFixture({
      rpId: RP, challenge: a1.challenge, origin: ORIGIN,
      credentialId: b64uDecode(finished.credentialId),
      privateJwk: fx.privateJwk, signCount: 6,
    });
    expect(
      await auth.finishAuthentication({
        userId: "u-5", rpId: RP, expectedOrigin: ORIGIN, assertion: sig1.assertion,
      }),
    ).toBe(true);
    const a2 = auth.beginAuthentication({ userId: "u-5", rpId: RP });
    const sigBad = await makeAssertionFixture({
      rpId: RP, challenge: a2.challenge, origin: ORIGIN,
      credentialId: b64uDecode(finished.credentialId),
      privateJwk: fx.privateJwk, signCount: 6, // no advance
    });
    expect(
      await auth.finishAuthentication({
        userId: "u-5", rpId: RP, expectedOrigin: ORIGIN, assertion: sigBad.assertion,
      }),
    ).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { buildPasskeyRouter } from "./passkey.js";
import {
  MemoryChallengeStore,
  MemoryCredentialStore,
  makeRegistrationFixture,
  makeAssertionFixture,
  b64uDecode,
} from "@vsbs/security";

const RP = "vsbs.app";
const ORIGIN = "https://vsbs.app";

function buildApp() {
  const credentials = new MemoryCredentialStore();
  const challenges = new MemoryChallengeStore();
  const app = new Hono();
  app.route(
    "/v1/auth/passkey",
    buildPasskeyRouter({ rpId: RP, expectedOrigin: ORIGIN, credentials, challenges }),
  );
  return { app, credentials, challenges };
}

describe("POST /v1/auth/passkey/*", () => {
  it("registers and authenticates an ES256 passkey end to end", async () => {
    const { app } = buildApp();
    const userId = "u-1";
    // begin registration
    const r1 = await app.request("/v1/auth/passkey/register/begin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    expect(r1.status).toBe(200);
    const beginBody = (await r1.json()) as { data: { challenge: string } };
    const challenge = beginBody.data.challenge;
    const fixture = await makeRegistrationFixture({ rpId: RP, challenge, origin: ORIGIN });
    // finish registration
    const r2 = await app.request("/v1/auth/passkey/register/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, attestation: fixture.attestation }),
    });
    expect(r2.status).toBe(200);
    const finishBody = (await r2.json()) as { data: { credentialId: string; algName: string } };
    expect(finishBody.data.algName).toBe("ES256");

    // begin authentication
    const r3 = await app.request("/v1/auth/passkey/auth/begin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    expect(r3.status).toBe(200);
    const authBegin = (await r3.json()) as { data: { challenge: string } };
    const assertion = await makeAssertionFixture({
      rpId: RP, challenge: authBegin.data.challenge, origin: ORIGIN,
      credentialId: b64uDecode(finishBody.data.credentialId),
      privateJwk: fixture.privateJwk, signCount: 5,
    });
    // finish authentication
    const r4 = await app.request("/v1/auth/passkey/auth/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, assertion: assertion.assertion }),
    });
    expect(r4.status).toBe(200);
    const ok = (await r4.json()) as { data: { ok: boolean } };
    expect(ok.data.ok).toBe(true);
  });

  it("returns 400 on malformed attestation payload", async () => {
    const { app } = buildApp();
    const r = await app.request("/v1/auth/passkey/register/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "u-2", attestation: { type: "bad" } }),
    });
    expect(r.status).toBe(400);
  });

  it("returns 401 on a forged assertion", async () => {
    const { app } = buildApp();
    const userId = "u-3";
    const r1 = await app.request("/v1/auth/passkey/register/begin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const begin = (await r1.json()) as { data: { challenge: string } };
    const fx = await makeRegistrationFixture({ rpId: RP, challenge: begin.data.challenge, origin: ORIGIN });
    await app.request("/v1/auth/passkey/register/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, attestation: fx.attestation }),
    });
    // Use a wrong-origin assertion.
    const r3 = await app.request("/v1/auth/passkey/auth/begin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const ab = (await r3.json()) as { data: { challenge: string } };
    const bad = await makeAssertionFixture({
      rpId: RP, challenge: ab.data.challenge, origin: "https://attacker.example",
      credentialId: fx.credentialId, privateJwk: fx.privateJwk, signCount: 1,
    });
    const r4 = await app.request("/v1/auth/passkey/auth/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, assertion: bad.assertion }),
    });
    expect(r4.status).toBe(401);
  });
});

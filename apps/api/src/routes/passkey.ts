// =============================================================================
// WebAuthn passkey routes.
//
// Endpoints:
//   POST /v1/auth/passkey/register/begin
//   POST /v1/auth/passkey/register/finish
//   POST /v1/auth/passkey/auth/begin
//   POST /v1/auth/passkey/auth/finish
//
// All payloads validated through the schemas in @vsbs/security/webauthn. The
// authenticator is built from a per-process MemoryCredentialStore and
// MemoryChallengeStore. Production swaps the store via constructor injection
// in `buildPasskeyRouter({ credentials, challenges })`. The state machine is
// identical in sim and live (docs/simulation-policy.md): only the storage
// driver differs.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";
import {
  AssertionResponseSchema,
  AttestationResponseSchema,
  MemoryChallengeStore,
  MemoryCredentialStore,
  makePasskeyAuthenticator,
  type ChallengeStore,
  type CredentialStore,
} from "@vsbs/security";

export interface PasskeyRouterOptions {
  rpId: string;
  expectedOrigin: string;
  credentials?: CredentialStore;
  challenges?: ChallengeStore;
}

const RegBeginSchema = z.object({
  userId: z.string().min(1).max(128),
});
const RegFinishSchema = z.object({
  userId: z.string().min(1).max(128),
  attestation: AttestationResponseSchema,
});
const AuthBeginSchema = z.object({
  userId: z.string().min(1).max(128),
});
const AuthFinishSchema = z.object({
  userId: z.string().min(1).max(128),
  assertion: AssertionResponseSchema,
});

export function buildPasskeyRouter(opts: PasskeyRouterOptions) {
  const credentials = opts.credentials ?? new MemoryCredentialStore();
  const challenges = opts.challenges ?? new MemoryChallengeStore();
  const authn = makePasskeyAuthenticator({ credentials, challenges });
  const router = new Hono();

  router.post("/register/begin", zv("json", RegBeginSchema), (c) => {
    const { userId } = c.req.valid("json");
    const out = authn.beginRegistration({ userId, rpId: opts.rpId });
    return c.json({ data: out });
  });

  router.post("/register/finish", zv("json", RegFinishSchema), async (c) => {
    const { userId, attestation } = c.req.valid("json");
    try {
      const out = await authn.finishRegistration({
        userId, rpId: opts.rpId, expectedOrigin: opts.expectedOrigin, attestation,
      });
      return c.json({ data: out });
    } catch (e) {
      return c.json(
        { error: { code: "PASSKEY_REGISTRATION_FAILED", message: (e as Error).message } },
        400,
      );
    }
  });

  router.post("/auth/begin", zv("json", AuthBeginSchema), (c) => {
    const { userId } = c.req.valid("json");
    const out = authn.beginAuthentication({ userId, rpId: opts.rpId });
    return c.json({ data: out });
  });

  router.post("/auth/finish", zv("json", AuthFinishSchema), async (c) => {
    const { userId, assertion } = c.req.valid("json");
    const ok = await authn.finishAuthentication({
      userId, rpId: opts.rpId, expectedOrigin: opts.expectedOrigin, assertion,
    });
    if (!ok) {
      return c.json({ error: { code: "PASSKEY_AUTH_FAILED", message: "Assertion did not verify" } }, 401);
    }
    return c.json({ data: { ok: true } });
  });

  return router;
}

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
//
// User identity is taken from `c.var.ownerSubject`, set by the upstream
// `requireSession` middleware. The bodies no longer carry a `userId`
// field — clients can no longer name an arbitrary subject; they can only
// bind credentials for the subject they are already authenticated as.
// =============================================================================

import {
	AssertionResponseSchema,
	AttestationResponseSchema,
	type ChallengeStore,
	type CredentialStore,
	MemoryChallengeStore,
	MemoryCredentialStore,
	makePasskeyAuthenticator,
} from "@vsbs/security";
import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";

import { type SessionAppEnv, requireSession } from "../middleware/session.js";

export interface PasskeyRouterOptions {
	/** HMAC signing key for the session bearer. Required. */
	signingKey: string;
	rpId: string;
	expectedOrigin: string;
	credentials?: CredentialStore;
	challenges?: ChallengeStore;
}

const RegBeginSchema = z.object({}).strict();
const RegFinishSchema = z
	.object({
		attestation: AttestationResponseSchema,
	})
	.strict();
const AuthBeginSchema = z.object({}).strict();
const AuthFinishSchema = z
	.object({
		assertion: AssertionResponseSchema,
	})
	.strict();

export function buildPasskeyRouter(opts: PasskeyRouterOptions) {
	const credentials = opts.credentials ?? new MemoryCredentialStore();
	const challenges = opts.challenges ?? new MemoryChallengeStore();
	const authn = makePasskeyAuthenticator({ credentials, challenges });
	const router = new Hono<SessionAppEnv>();

	router.use("*", requireSession({ signingKey: opts.signingKey }));

	router.post("/register/begin", zv("json", RegBeginSchema), (c) => {
		const userId = c.get("ownerSubject");
		const out = authn.beginRegistration({ userId, rpId: opts.rpId });
		return c.json({ data: out });
	});

	router.post("/register/finish", zv("json", RegFinishSchema), async (c) => {
		const userId = c.get("ownerSubject");
		const { attestation } = c.req.valid("json");
		try {
			const out = await authn.finishRegistration({
				userId,
				rpId: opts.rpId,
				expectedOrigin: opts.expectedOrigin,
				attestation,
			});
			return c.json({ data: out });
		} catch (e) {
			return c.json(
				{
					error: {
						code: "PASSKEY_REGISTRATION_FAILED",
						message: (e as Error).message,
					},
				},
				400,
			);
		}
	});

	router.post("/auth/begin", zv("json", AuthBeginSchema), (c) => {
		const userId = c.get("ownerSubject");
		const out = authn.beginAuthentication({ userId, rpId: opts.rpId });
		return c.json({ data: out });
	});

	router.post("/auth/finish", zv("json", AuthFinishSchema), async (c) => {
		const userId = c.get("ownerSubject");
		const { assertion } = c.req.valid("json");
		const ok = await authn.finishAuthentication({
			userId,
			rpId: opts.rpId,
			expectedOrigin: opts.expectedOrigin,
			assertion,
		});
		if (!ok) {
			return c.json(
				{
					error: {
						code: "PASSKEY_AUTH_FAILED",
						message: "Assertion did not verify",
					},
				},
				401,
			);
		}
		return c.json({ data: { ok: true } });
	});

	return router;
}

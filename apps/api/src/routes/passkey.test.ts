import {
	MemoryChallengeStore,
	MemoryCredentialStore,
	b64uDecode,
	makeAssertionFixture,
	makeRegistrationFixture,
} from "@vsbs/security";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type SessionAppEnv, signSession } from "../middleware/session.js";
import { buildPasskeyRouter } from "./passkey.js";

const RP = "vsbs.app";
const ORIGIN = "https://vsbs.app";
const SIGN_KEY = "vsbs-test-session-signing-key-32-bytes-or-more-please";

async function bearer(subject: string): Promise<string> {
	const s = await signSession({ subject }, { signingKey: SIGN_KEY, defaultTtlSeconds: 3600 });
	return `Bearer ${s.token}`;
}

function buildApp() {
	const credentials = new MemoryCredentialStore();
	const challenges = new MemoryChallengeStore();
	const app = new Hono<SessionAppEnv>();
	app.route(
		"/v1/auth/passkey",
		buildPasskeyRouter({
			signingKey: SIGN_KEY,
			rpId: RP,
			expectedOrigin: ORIGIN,
			credentials,
			challenges,
		}),
	);
	return { app, credentials, challenges };
}

describe("POST /v1/auth/passkey/*", () => {
	it("rejects requests without an Authorization bearer with 401 SESSION_REQUIRED", async () => {
		const { app } = buildApp();
		const r = await app.request("/v1/auth/passkey/register/begin", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(r.status).toBe(401);
		const body = (await r.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_REQUIRED");
	});

	it("registers and authenticates an ES256 passkey end to end (subject = session)", async () => {
		const { app } = buildApp();
		const userId = "u-1";
		const auth = await bearer(userId);
		// begin registration
		const r1 = await app.request("/v1/auth/passkey/register/begin", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({}),
		});
		expect(r1.status).toBe(200);
		const beginBody = (await r1.json()) as { data: { challenge: string } };
		const challenge = beginBody.data.challenge;
		const fixture = await makeRegistrationFixture({
			rpId: RP,
			challenge,
			origin: ORIGIN,
		});
		// finish registration
		const r2 = await app.request("/v1/auth/passkey/register/finish", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({ attestation: fixture.attestation }),
		});
		expect(r2.status).toBe(200);
		const finishBody = (await r2.json()) as {
			data: { credentialId: string; algName: string };
		};
		expect(finishBody.data.algName).toBe("ES256");

		// begin authentication
		const r3 = await app.request("/v1/auth/passkey/auth/begin", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({}),
		});
		expect(r3.status).toBe(200);
		const authBegin = (await r3.json()) as { data: { challenge: string } };
		const assertion = await makeAssertionFixture({
			rpId: RP,
			challenge: authBegin.data.challenge,
			origin: ORIGIN,
			credentialId: b64uDecode(finishBody.data.credentialId),
			privateJwk: fixture.privateJwk,
			signCount: 5,
		});
		// finish authentication
		const r4 = await app.request("/v1/auth/passkey/auth/finish", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({ assertion: assertion.assertion }),
		});
		expect(r4.status).toBe(200);
		const ok = (await r4.json()) as { data: { ok: boolean } };
		expect(ok.data.ok).toBe(true);
	});

	it("rejects body fields that try to forge a userId — strict schema", async () => {
		const { app } = buildApp();
		const r = await app.request("/v1/auth/passkey/register/begin", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("real-subject"),
			},
			body: JSON.stringify({ userId: "spoofed-subject" }),
		});
		expect(r.status).toBe(400);
	});

	it("returns 400 on malformed attestation payload", async () => {
		const { app } = buildApp();
		const r = await app.request("/v1/auth/passkey/register/finish", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("u-2"),
			},
			body: JSON.stringify({ attestation: { type: "bad" } }),
		});
		expect(r.status).toBe(400);
	});

	it("returns 401 on a forged assertion", async () => {
		const { app } = buildApp();
		const userId = "u-3";
		const auth = await bearer(userId);
		const r1 = await app.request("/v1/auth/passkey/register/begin", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({}),
		});
		const begin = (await r1.json()) as { data: { challenge: string } };
		const fx = await makeRegistrationFixture({
			rpId: RP,
			challenge: begin.data.challenge,
			origin: ORIGIN,
		});
		await app.request("/v1/auth/passkey/register/finish", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({ attestation: fx.attestation }),
		});
		// Use a wrong-origin assertion.
		const r3 = await app.request("/v1/auth/passkey/auth/begin", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({}),
		});
		const ab = (await r3.json()) as { data: { challenge: string } };
		const bad = await makeAssertionFixture({
			rpId: RP,
			challenge: ab.data.challenge,
			origin: "https://attacker.example",
			credentialId: fx.credentialId,
			privateJwk: fx.privateJwk,
			signCount: 1,
		});
		const r4 = await app.request("/v1/auth/passkey/auth/finish", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({ assertion: bad.assertion }),
		});
		expect(r4.status).toBe(401);
	});

	it("isolates credentials by session subject — registering as A then probing as B fails", async () => {
		const { app } = buildApp();
		const userA = "subject-a";
		const userB = "subject-b";
		const authA = await bearer(userA);
		const authB = await bearer(userB);

		// A registers a credential.
		const r1 = await app.request("/v1/auth/passkey/register/begin", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: authA },
			body: JSON.stringify({}),
		});
		const begin = (await r1.json()) as { data: { challenge: string } };
		const fx = await makeRegistrationFixture({
			rpId: RP,
			challenge: begin.data.challenge,
			origin: ORIGIN,
		});
		const r2 = await app.request("/v1/auth/passkey/register/finish", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: authA },
			body: JSON.stringify({ attestation: fx.attestation }),
		});
		expect(r2.status).toBe(200);

		// B tries to begin authentication — must get a fresh challenge bound
		// to subject B (no credentials), so finishAuthentication will fail.
		const r3 = await app.request("/v1/auth/passkey/auth/begin", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: authB },
			body: JSON.stringify({}),
		});
		expect(r3.status).toBe(200);
		const ab = (await r3.json()) as { data: { challenge: string } };
		// B replays a forged assertion using A's keypair.
		const bad = await makeAssertionFixture({
			rpId: RP,
			challenge: ab.data.challenge,
			origin: ORIGIN,
			credentialId: fx.credentialId,
			privateJwk: fx.privateJwk,
			signCount: 1,
		});
		const r4 = await app.request("/v1/auth/passkey/auth/finish", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: authB },
			body: JSON.stringify({ assertion: bad.assertion }),
		});
		expect(r4.status).toBe(401);
	});
});

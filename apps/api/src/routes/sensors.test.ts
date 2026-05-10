// =============================================================================
// Sensors route tests — exercises session bearer + producer HMAC dual-mode.
// =============================================================================

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Env } from "../env.js";
import { type AppEnv, requestId } from "../middleware/security.js";
import { hmacSha256, signSession } from "../middleware/session.js";
import { buildSensorsRouter } from "./sensors.js";

const SIGN_KEY = "test-signing-key-must-be-at-least-32-chars-long";

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
	AUTONOMY_ENABLED: false,
	AUTONOMY_MODE: "sim",
	AUTONOMY_DEFAULT_AUTOPAY_CAP_INR: 0,
	AUTONOMY_DEFAULT_AUTOPAY_CAP_USD: 0,
	MERCEDES_IPP_MODE: "sim",
	LLM_PROFILE: "sim",
	SESSION_SIGNING_KEY: SIGN_KEY,
	SESSION_TTL_SECONDS: 86400,
	ADMIN_AUTH_MODE: "sim",
	GCP_IAP_ISSUER: "https://cloud.google.com/iap",
	GCP_IAP_JWKS_URL: "https://www.gstatic.com/iap/verify/public_key-jwk",
};

async function bearer(sub: string): Promise<string> {
	const s = await signSession({ subject: sub }, { signingKey: SIGN_KEY, defaultTtlSeconds: 3600 });
	return `Bearer ${s.token}`;
}

function buildApp() {
	const app = new Hono<AppEnv>();
	app.use("*", requestId());
	app.route("/v1/sensors", buildSensorsRouter(baseEnv));
	return app;
}

const sample = {
	channel: "obd-pid",
	timestamp: "2026-04-15T10:00:00.000Z",
	origin: "sim",
	vehicleId: "veh-1",
	value: { rpm: 1800 },
	health: { selfTestOk: true, trust: 1 },
};

const ingestBody = { vehicleId: "veh-1", samples: [sample] };

function bytesToB64Url(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function vehicleToken(vehicleId: string, body: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
	const bodyHash = bytesToB64Url(new Uint8Array(digest));
	return hmacSha256(SIGN_KEY, `${vehicleId}.${bodyHash}`);
}

describe("sensors routes — dual-mode auth", () => {
	it("rejects unauthenticated ingest with 401", async () => {
		const app = buildApp();
		const res = await app.request("/v1/sensors/ingest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(ingestBody),
		});
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toMatchObject({
			error: { code: "INGEST_AUTH_REQUIRED" },
		});
	});

	it("accepts ingest with a valid session bearer", async () => {
		const app = buildApp();
		const auth = await bearer("owner-1");
		const res = await app.request("/v1/sensors/ingest", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify(ingestBody),
		});
		expect(res.status).toBe(202);
		const body = await res.json();
		expect(body.data.accepted).toBe(1);
	});

	it("accepts ingest with a valid x-vsbs-vehicle-token HMAC", async () => {
		const app = buildApp();
		const raw = JSON.stringify(ingestBody);
		const token = await vehicleToken(ingestBody.vehicleId, raw);
		const res = await app.request("/v1/sensors/ingest", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-vsbs-vehicle-token": token,
			},
			body: raw,
		});
		expect(res.status).toBe(202);
	});

	it("rejects ingest with a tampered HMAC", async () => {
		const app = buildApp();
		const raw = JSON.stringify(ingestBody);
		const res = await app.request("/v1/sensors/ingest", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-vsbs-vehicle-token": "wrong-token-bytes",
			},
			body: raw,
		});
		expect(res.status).toBe(401);
	});

	it("requires a session for /:vehicleId/latest", async () => {
		const app = buildApp();
		const res = await app.request("/v1/sensors/veh-1/latest");
		expect(res.status).toBe(401);
	});

	it("/:vehicleId/latest returns the most recent sample with a session", async () => {
		const app = buildApp();
		const auth = await bearer("owner-1");
		await app.request("/v1/sensors/ingest", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify(ingestBody),
		});
		const res = await app.request("/v1/sensors/veh-1/latest", {
			headers: { authorization: auth },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data["obd-pid"].vehicleId).toBe("veh-1");
	});
});

// =============================================================================
// Payment route tests — exercises session gate + booking-ownership check.
// Webhook routes use HMAC, not session, and are covered by the adapter tests.
// =============================================================================

import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import type { Env } from "../env.js";
import type { AppEnv } from "../middleware/security.js";
import { signSession } from "../middleware/session.js";
import { __resetBookingsStoreForTest, buildBookingsRouter } from "./bookings.js";
import { buildPaymentRouter } from "./payment.js";

const SIGN_KEY = "test-signing-key-must-be-at-least-32-chars-long";

const baseEnv: Env = {
	NODE_ENV: "test",
	LOG_LEVEL: "error",
	APP_DEMO_MODE: true,
	APP_REGION: "asia-south1",
	APP_REGIONS: "asia-south1",
	APP_REGION_RUNTIME: "asia-south1",
	APP_REGION_EU_BLOCK: false,
	IDENTITY_PLATFORM_SIGNING_KEY: "test-identity-signing-key-1234",
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

const validBookingBody = {
	owner: { phone: "+919876543210", subject: "Priya" },
	vehicle: {
		vin: "1HGCM82633A004352",
		make: "Honda",
		model: "City",
		year: 2021,
	},
	issue: {
		symptoms: "Brake pedal feels soft.",
		canDriveSafely: "yes-cautiously" as const,
		redFlags: ["brakes"],
	},
	safety: {
		severity: "amber" as const,
		rationale: "Brake symptoms need prompt inspection.",
		triggered: ["brake-noise"],
	},
	source: "web" as const,
};

function buildApp() {
	const app = new Hono<AppEnv>();
	app.route("/v1/bookings", buildBookingsRouter({ signingKey: SIGN_KEY }));
	app.route("/v1/payments", buildPaymentRouter(baseEnv, { signingKey: SIGN_KEY }));
	return app;
}

async function createBooking(app: Hono<AppEnv>, auth: string): Promise<string> {
	const res = await app.request("/v1/bookings", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: auth },
		body: JSON.stringify(validBookingBody),
	});
	expect(res.status).toBe(201);
	const body = await res.json();
	return body.data.id as string;
}

afterEach(() => {
	__resetBookingsStoreForTest();
});

describe("payment routes — auth + ownership", () => {
	it("rejects unauthenticated POST /orders with 401", async () => {
		const app = buildApp();
		const res = await app.request("/v1/payments/orders", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				bookingId: "00000000-0000-4000-8000-000000000000",
				amount: { currency: "INR", amountMinor: 50000 },
				idempotencyKey: "idem-12345678",
			}),
		});
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toMatchObject({
			error: { code: "SESSION_REQUIRED" },
		});
	});

	it("rejects POST /orders for a booking owned by someone else with 403", async () => {
		const app = buildApp();
		const ownerAuth = await bearer("owner-1");
		const intruderAuth = await bearer("attacker-2");
		const bookingId = await createBooking(app, ownerAuth);

		const res = await app.request("/v1/payments/orders", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: intruderAuth,
			},
			body: JSON.stringify({
				bookingId,
				amount: { currency: "INR", amountMinor: 50000 },
				idempotencyKey: "idem-12345678",
			}),
		});
		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({
			error: { code: "PAYMENT_FORBIDDEN" },
		});
	});

	it("returns 404 PAYMENT/BOOKING_NOT_FOUND when bookingId is unknown", async () => {
		const app = buildApp();
		const auth = await bearer("owner-1");
		const res = await app.request("/v1/payments/orders", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({
				bookingId: "11111111-2222-4333-8444-555555555555",
				amount: { currency: "INR", amountMinor: 50000 },
				idempotencyKey: "idem-12345678",
			}),
		});
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toMatchObject({
			error: { code: "BOOKING_NOT_FOUND" },
		});
	});

	it("happy path: owner creates an order then an intent then captures", async () => {
		const app = buildApp();
		const auth = await bearer("owner-1");
		const bookingId = await createBooking(app, auth);

		const orderRes = await app.request("/v1/payments/orders", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({
				bookingId,
				amount: { currency: "INR", amountMinor: 50000 },
				idempotencyKey: "idem-12345678",
			}),
		});
		expect(orderRes.status).toBe(201);
		const order = (await orderRes.json()).data;
		expect(order.bookingId).toBe(bookingId);

		const intentRes = await app.request(`/v1/payments/orders/${order.orderId}/intents`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({ method: "card" }),
		});
		expect(intentRes.status).toBe(201);
		const intent = (await intentRes.json()).data;

		const authoriseRes = await app.request(`/v1/payments/intents/${intent.intentId}/authorise`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({ ok: true }),
		});
		expect(authoriseRes.status).toBe(200);

		const captureRes = await app.request(`/v1/payments/orders/${order.orderId}/capture`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
		});
		expect(captureRes.status).toBe(200);
	});

	it("rejects intent ops when caller does not own the underlying booking", async () => {
		const app = buildApp();
		const ownerAuth = await bearer("owner-1");
		const intruderAuth = await bearer("attacker-2");
		const bookingId = await createBooking(app, ownerAuth);

		const orderRes = await app.request("/v1/payments/orders", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: ownerAuth },
			body: JSON.stringify({
				bookingId,
				amount: { currency: "INR", amountMinor: 50000 },
				idempotencyKey: "idem-abcd1234",
			}),
		});
		const order = (await orderRes.json()).data;

		const res = await app.request(`/v1/payments/orders/${order.orderId}/capture`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: intruderAuth,
			},
		});
		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({
			error: { code: "PAYMENT_FORBIDDEN" },
		});
	});
});

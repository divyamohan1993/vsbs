import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../middleware/security.js";
import { signSession } from "../middleware/session.js";
import { __resetBookingsStoreForTest, buildBookingsRouter } from "./bookings.js";

const SIGN_KEY = "test-signing-key-must-be-at-least-32-chars-long";

async function bearer(sub: string): Promise<string> {
	const s = await signSession({ subject: sub }, { signingKey: SIGN_KEY, defaultTtlSeconds: 3600 });
	return `Bearer ${s.token}`;
}

function buildApp() {
	const app = new Hono<AppEnv>();
	app.route("/", buildBookingsRouter({ signingKey: SIGN_KEY }));
	return app;
}

const validBookingBody = {
	owner: {
		phone: "+919876543210",
		subject: "Priya",
	},
	vehicle: {
		vin: "1HGCM82633A004352",
		make: "Honda",
		model: "City",
		year: 2021,
	},
	issue: {
		symptoms: "Brake pedal feels soft and there is a mild squeal.",
		canDriveSafely: "yes-cautiously",
		redFlags: ["brakes"],
	},
	safety: {
		severity: "amber",
		rationale: "Brake symptoms need prompt inspection but vehicle is movable.",
		triggered: ["brake-noise"],
	},
	source: "web",
};

afterEach(() => {
	__resetBookingsStoreForTest();
});

describe("bookings routes", () => {
	it("creates a booking and returns it by id (owner match)", async () => {
		const app = buildApp();
		const auth = await bearer("owner-1");

		const createRes = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify(validBookingBody),
		});

		expect(createRes.status).toBe(201);
		const created = await createRes.json();
		expect(created.data).toMatchObject({
			status: "accepted",
			source: "web",
			ownerSubject: "owner-1",
			owner: validBookingBody.owner,
			vehicle: validBookingBody.vehicle,
			issue: validBookingBody.issue,
			safety: validBookingBody.safety,
		});
		expect(created.data.id).toEqual(expect.any(String));

		const getRes = await app.request(`/${created.data.id}`, {
			headers: { authorization: auth },
		});

		expect(getRes.status).toBe(200);
		await expect(getRes.json()).resolves.toEqual(created);
	});

	it("rejects unauthenticated create with 401", async () => {
		const app = buildApp();
		const res = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validBookingBody),
		});
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toMatchObject({
			error: { code: "SESSION_REQUIRED" },
		});
	});

	it("rejects cross-owner read with 403", async () => {
		const app = buildApp();
		const ownerAuth = await bearer("owner-1");
		const intruderAuth = await bearer("attacker-2");

		const createRes = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: ownerAuth },
			body: JSON.stringify(validBookingBody),
		});
		const created = await createRes.json();

		const res = await app.request(`/${created.data.id}`, {
			headers: { authorization: intruderAuth },
		});
		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({
			error: { code: "BOOKING_FORBIDDEN" },
		});
	});

	it("rejects invalid create requests with validation error", async () => {
		const app = buildApp();
		const auth = await bearer("owner-1");

		const res = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify({
				...validBookingBody,
				issue: {
					...validBookingBody.issue,
					canDriveSafely: "maybe",
				},
			}),
		});

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
			},
		});
	});

	it("returns 404 JSON for missing bookings", async () => {
		const app = buildApp();
		const auth = await bearer("owner-1");

		const res = await app.request("/missing-booking", {
			headers: { authorization: auth },
		});

		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toMatchObject({
			error: {
				code: "BOOKING_NOT_FOUND",
			},
		});
	});

	it("emits frame and end stream events for the owner", async () => {
		const app = buildApp();
		const auth = await bearer("owner-1");

		const created = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: auth },
			body: JSON.stringify(validBookingBody),
		});
		const body = await created.json();

		const res = await app.request(`/${body.data.id}/stream`, {
			headers: { authorization: auth },
		});
		const text = await res.text();

		expect(res.status).toBe(200);
		expect(text).toContain("event: frame");
		expect(text).toContain("event: end");
	}, 7_000);
});

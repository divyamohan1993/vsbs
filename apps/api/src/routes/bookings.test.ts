import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import type { AppEnv } from "../middleware/security.js";
import { buildBookingsRouter } from "./bookings.js";

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route("/", buildBookingsRouter());
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

describe("bookings routes", () => {
  it("creates a booking and returns it by id", async () => {
    const app = buildApp();

    const createRes = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBookingBody),
    });

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.data).toMatchObject({
      status: "accepted",
      source: "web",
      owner: validBookingBody.owner,
      vehicle: validBookingBody.vehicle,
      issue: validBookingBody.issue,
      safety: validBookingBody.safety,
    });
    expect(created.data.id).toEqual(expect.any(String));
    expect(created.data.createdAt).toEqual(expect.any(String));
    expect(created.data.updatedAt).toBe(created.data.createdAt);

    const getRes = await app.request(`/${created.data.id}`);

    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toEqual(created);
  });

  it("rejects invalid create requests with validation error", async () => {
    const app = buildApp();

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
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

    const res = await app.request("/missing-booking");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "BOOKING_NOT_FOUND",
      },
    });
  });

  it("keeps emitting frame and end stream events", async () => {
    const app = buildApp();

    const res = await app.request("/demo-booking/stream");
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("event: frame");
    expect(text).toContain("event: end");
  }, 7_000);
});

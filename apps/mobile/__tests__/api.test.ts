

import { BookingCreateSchema, BookingSchema, VinDecodeResultSchema, SensorIngestResultSchema } from "../src/lib/api";

describe("api Zod schemas", () => {
  it("accepts a valid booking-create payload", () => {
    const ok = BookingCreateSchema.safeParse({
      owner: { phone: "+919999999999" },
      vehicle: { make: "Honda", model: "Civic", year: 2024 },
      issue: {
        symptoms: "grinding when braking",
        canDriveSafely: "yes-cautiously",
        redFlags: [],
      },
      safety: { severity: "amber", rationale: "ok", triggered: [] },
      source: "mobile",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an unknown severity value", () => {
    const bad = BookingCreateSchema.safeParse({
      owner: { phone: "+910000000000" },
      vehicle: {},
      issue: { symptoms: "x", canDriveSafely: "yes-confidently", redFlags: [] },
      safety: { severity: "purple", rationale: "x", triggered: [] },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a booking without symptoms", () => {
    const bad = BookingCreateSchema.safeParse({
      owner: { phone: "+910000000000" },
      vehicle: {},
      issue: { symptoms: "", canDriveSafely: "no", redFlags: [] },
      safety: { severity: "red", rationale: "x", triggered: [] },
    });
    expect(bad.success).toBe(false);
  });

  it("Booking response requires id + timestamps", () => {
    const ok = BookingSchema.safeParse({
      id: "b-1",
      status: "accepted",
      createdAt: "2026-04-15T10:00:00.000Z",
      updatedAt: "2026-04-15T10:00:00.000Z",
      source: "mobile",
      owner: { phone: "+91" },
      vehicle: {},
      issue: { symptoms: "noise", canDriveSafely: "yes-confidently", redFlags: [] },
      safety: { severity: "green", rationale: "ok", triggered: [] },
    });
    expect(ok.success).toBe(true);
  });

  it("VIN decode result accepts partial fields", () => {
    expect(
      VinDecodeResultSchema.safeParse({ vin: "1HGBH41JXMN109186" }).success,
    ).toBe(true);
    expect(
      VinDecodeResultSchema.safeParse({
        vin: "1HGBH41JXMN109186",
        make: "Honda",
        model: "Civic",
        year: 2021,
      }).success,
    ).toBe(true);
  });

  it("sensor ingest accepts non-negative count", () => {
    const ok = SensorIngestResultSchema.safeParse({ accepted: 12 });
    expect(ok.success).toBe(true);
    const bad = SensorIngestResultSchema.safeParse({ accepted: -1 });
    expect(bad.success).toBe(false);
  });
});

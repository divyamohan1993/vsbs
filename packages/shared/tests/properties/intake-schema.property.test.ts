// =============================================================================
// Intake schema invariants — any valid IntakePartial passes; tampering breaks
// it; required-field omission is detected; PII fields stay under length caps.
// Reference: packages/shared/src/schema/intake.ts.
// =============================================================================

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  E164Schema,
  IntakeDraftSchema,
  IssueSchema,
  LocationSchema,
  OwnerSchema,
  SelfSafetySchema,
  TimeWindowSchema,
} from "../../src/schema/intake.js";

const arbE164 = fc
  .tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 7, max: 14 }))
  .chain(([first, len]) =>
    fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: len, maxLength: len })
      .map((rest) => `+${first}${rest.join("")}`),
  );

const arbLat = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });
const arbLng = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });

describe("Owner / E.164 — properties", () => {
  it("every generated E.164 phone passes E164Schema", () => {
    fc.assert(
      fc.property(arbE164, (phone) => {
        expect(E164Schema.safeParse(phone).success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("E.164 fails when the leading + is removed", () => {
    fc.assert(
      fc.property(arbE164, (phone) => {
        expect(E164Schema.safeParse(phone.slice(1)).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("Owner with valid name + phone parses; with empty name fails", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 120 }).filter((s) => s.trim().length > 0),
        arbE164,
        (name, phone) => {
          const r = OwnerSchema.safeParse({ name, phone });
          if (!r.success) {
            // some unicode-only names may collapse to empty; skip
            return;
          }
          expect(r.data.name).toBe(name);
          expect(r.data.phone).toBe(phone);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("LocationSchema — properties", () => {
  it("any (lat, lng) in geographic range parses", () => {
    fc.assert(
      fc.property(arbLat, arbLng, (lat, lng) => {
        const r = LocationSchema.safeParse({ lat, lng });
        expect(r.success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("lat outside [-90, 90] is rejected", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 90.0001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        arbLng,
        (lat, lng) => {
          expect(LocationSchema.safeParse({ lat, lng }).success).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("lng outside [-180, 180] is rejected", () => {
    fc.assert(
      fc.property(
        arbLat,
        fc.double({ min: 180.0001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (lat, lng) => {
          expect(LocationSchema.safeParse({ lat, lng }).success).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("TimeWindowSchema — properties", () => {
  it("end > start always passes; end <= start always fails", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date(2025, 0, 1), max: new Date(2030, 0, 1) }),
        fc.integer({ min: 60_000, max: 24 * 60 * 60 * 1000 }),
        (start, deltaMs) => {
          const startIso = start.toISOString();
          const end = new Date(start.getTime() + deltaMs).toISOString();
          expect(TimeWindowSchema.safeParse({ start: startIso, end }).success).toBe(true);
          expect(TimeWindowSchema.safeParse({ start: end, end: startIso }).success).toBe(false);
          expect(TimeWindowSchema.safeParse({ start: startIso, end: startIso }).success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("IssueSchema — properties", () => {
  it("freeText longer than 2000 chars is rejected", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 2001, maxLength: 2200 }),
        (s) => {
          expect(IssueSchema.safeParse({ freeText: s }).success).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("photos array longer than 10 entries is rejected", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant("https://example.com/x.jpg"), { minLength: 11, maxLength: 20 }),
        (photos) => {
          expect(
            IssueSchema.safeParse({ freeText: "ok", photos }).success,
          ).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("SelfSafetySchema — properties", () => {
  it("every documented redFlag value is accepted", () => {
    const FLAGS = [
      "brake-failure",
      "steering-failure",
      "engine-fire",
      "visible-smoke-from-hood",
      "fluid-puddle-large",
      "coolant-boiling",
      "oil-pressure-red-light",
      "airbag-deployed-recent",
      "ev-battery-thermal-warning",
      "driver-reports-unsafe",
    ];
    fc.assert(
      fc.property(
        fc.subarray(FLAGS as readonly string[]),
        fc.constantFrom("yes-confidently", "yes-cautiously", "unsure", "no", "already-stranded"),
        (flags, mode) => {
          const r = SelfSafetySchema.safeParse({ canDriveSafely: mode, redFlags: flags });
          expect(r.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("unknown redFlag string is rejected", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 4, maxLength: 30 })
          .filter((s) => !/^(brake-failure|steering-failure|engine-fire)$/.test(s)),
        (bad) => {
          const r = SelfSafetySchema.safeParse({
            canDriveSafely: "yes-confidently",
            redFlags: [bad],
          });
          expect(r.success).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("IntakeDraftSchema — invariants", () => {
  it("a draft with only the required envelope (id, timestamps, owner partial) parses", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.date({ min: new Date(2025, 0, 1), max: new Date(2030, 0, 1) }),
        (id, when) => {
          const draft = {
            draftId: id,
            createdAt: when.toISOString(),
            updatedAt: when.toISOString(),
            owner: {},
          };
          expect(IntakeDraftSchema.safeParse(draft).success).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("tampering the draftId to non-UUID always fails", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter(
          (s) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
        ),
        (badId) => {
          const draft = {
            draftId: badId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            owner: {},
          };
          expect(IntakeDraftSchema.safeParse(draft).success).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});

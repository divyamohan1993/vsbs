import { describe, it, expect } from "vitest";
import {
  OperationalDesignDomainSchema,
  OperationalContextSchema,
  oddSatisfied,
  requireOdd,
  OddViolation,
  type OperationalDesignDomain,
  type OperationalContext,
} from "./odd.js";

const baseOdd: OperationalDesignDomain = {
  region: ["IN", "DE"],
  weather: ["clear", "rain"],
  timeOfDay: ["day", "dawn-dusk"],
  vehicleClass: ["passenger-light"],
  roadClass: ["urban-arterial", "highway"],
  maxSpeedKmh: 100,
};

const baseCtx: OperationalContext = {
  region: "IN",
  weather: "clear",
  timeOfDay: "day",
  vehicleClass: "passenger-light",
  roadClass: "urban-arterial",
  proposedSpeedKmh: 60,
};

describe("OperationalDesignDomainSchema", () => {
  it("accepts a well-formed envelope", () => {
    expect(() => OperationalDesignDomainSchema.parse(baseOdd)).not.toThrow();
  });

  it("rejects empty axis allow-lists", () => {
    expect(() =>
      OperationalDesignDomainSchema.parse({ ...baseOdd, region: [] }),
    ).toThrow();
    expect(() =>
      OperationalDesignDomainSchema.parse({ ...baseOdd, weather: [] }),
    ).toThrow();
    expect(() =>
      OperationalDesignDomainSchema.parse({ ...baseOdd, vehicleClass: [] }),
    ).toThrow();
  });

  it("rejects malformed ISO-3166 codes", () => {
    expect(() =>
      OperationalDesignDomainSchema.parse({ ...baseOdd, region: ["india"] }),
    ).toThrow();
    expect(() =>
      OperationalDesignDomainSchema.parse({ ...baseOdd, region: ["in"] }),
    ).toThrow();
  });

  it("accepts an optional geofenceId", () => {
    expect(() =>
      OperationalDesignDomainSchema.parse({ ...baseOdd, geofenceId: "apcoa-stuttgart-p6" }),
    ).not.toThrow();
  });
});

describe("OperationalContextSchema", () => {
  it("accepts a well-formed context", () => {
    expect(() => OperationalContextSchema.parse(baseCtx)).not.toThrow();
  });

  it("rejects negative speeds", () => {
    expect(() =>
      OperationalContextSchema.parse({ ...baseCtx, proposedSpeedKmh: -1 }),
    ).toThrow();
  });
});

describe("oddSatisfied — positive cases per axis", () => {
  it("identical context inside envelope is ok", () => {
    expect(oddSatisfied(baseOdd, baseCtx).ok).toBe(true);
  });

  it("max-speed exactly equal to limit is ok", () => {
    expect(oddSatisfied(baseOdd, { ...baseCtx, proposedSpeedKmh: 100 }).ok).toBe(true);
  });

  it("any allowed weather is ok", () => {
    expect(oddSatisfied(baseOdd, { ...baseCtx, weather: "rain" }).ok).toBe(true);
  });

  it("any allowed time-of-day is ok", () => {
    expect(oddSatisfied(baseOdd, { ...baseCtx, timeOfDay: "dawn-dusk" }).ok).toBe(true);
  });

  it("any allowed road class is ok", () => {
    expect(oddSatisfied(baseOdd, { ...baseCtx, roadClass: "highway" }).ok).toBe(true);
  });

  it("matching geofenceId is ok", () => {
    const odd = { ...baseOdd, geofenceId: "g-1" };
    const ctx = { ...baseCtx, geofenceId: "g-1" };
    expect(oddSatisfied(odd, ctx).ok).toBe(true);
  });
});

describe("oddSatisfied — negative cases per axis", () => {
  it("region not in envelope", () => {
    const v = oddSatisfied(baseOdd, { ...baseCtx, region: "US" });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reasons.map((r) => r.code)).toContain("region-out-of-envelope");
  });

  it("weather not in envelope", () => {
    const v = oddSatisfied(baseOdd, { ...baseCtx, weather: "snow" });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reasons.map((r) => r.code)).toContain("weather-out-of-envelope");
  });

  it("time-of-day not in envelope", () => {
    const v = oddSatisfied(baseOdd, { ...baseCtx, timeOfDay: "night" });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reasons.map((r) => r.code)).toContain("time-of-day-out-of-envelope");
  });

  it("vehicle class not in envelope", () => {
    const v = oddSatisfied(baseOdd, { ...baseCtx, vehicleClass: "hcv" });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reasons.map((r) => r.code)).toContain("vehicle-class-out-of-envelope");
  });

  it("road class not in envelope", () => {
    const v = oddSatisfied(baseOdd, { ...baseCtx, roadClass: "off-road" });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reasons.map((r) => r.code)).toContain("road-class-out-of-envelope");
  });

  it("speed exceeds envelope", () => {
    const v = oddSatisfied(baseOdd, { ...baseCtx, proposedSpeedKmh: 120 });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reasons.map((r) => r.code)).toContain("speed-exceeds-envelope");
  });

  it("geofenceId required by ODD but missing in context", () => {
    const odd = { ...baseOdd, geofenceId: "g-1" };
    const v = oddSatisfied(odd, baseCtx);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reasons.map((r) => r.code)).toContain("geofence-mismatch");
  });

  it("geofenceId mismatch", () => {
    const odd = { ...baseOdd, geofenceId: "g-1" };
    const v = oddSatisfied(odd, { ...baseCtx, geofenceId: "g-2" });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reasons.map((r) => r.code)).toContain("geofence-mismatch");
  });
});

describe("oddSatisfied — multiple violation aggregation", () => {
  it("aggregates every failing axis in one verdict", () => {
    const v = oddSatisfied(baseOdd, {
      region: "JP",
      weather: "fog",
      timeOfDay: "night",
      vehicleClass: "hcv",
      roadClass: "off-road",
      proposedSpeedKmh: 200,
      geofenceId: "g-x",
    });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    const codes = v.reasons.map((r) => r.code).sort();
    expect(codes).toEqual([
      "region-out-of-envelope",
      "road-class-out-of-envelope",
      "speed-exceeds-envelope",
      "time-of-day-out-of-envelope",
      "vehicle-class-out-of-envelope",
      "weather-out-of-envelope",
    ]);
  });
});

describe("requireOdd — universal gate", () => {
  it("returns void on satisfied envelope", () => {
    expect(() => requireOdd(baseOdd, baseCtx)).not.toThrow();
  });

  it("throws OddViolation with structured reasons on failure", () => {
    try {
      requireOdd(baseOdd, { ...baseCtx, region: "JP", proposedSpeedKmh: 999 });
      throw new Error("requireOdd did not throw");
    } catch (e) {
      expect(e).toBeInstanceOf(OddViolation);
      const ov = e as OddViolation;
      expect(ov.code).toBe("odd-violation");
      expect(ov.reasons.length).toBe(2);
      const codes = ov.reasons.map((r) => r.code).sort();
      expect(codes).toEqual([
        "region-out-of-envelope",
        "speed-exceeds-envelope",
      ]);
    }
  });

  it("OddViolation message lists every failing code", () => {
    try {
      requireOdd(baseOdd, { ...baseCtx, region: "JP", weather: "snow" });
      throw new Error("requireOdd did not throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/region-out-of-envelope/);
      expect(msg).toMatch(/weather-out-of-envelope/);
    }
  });
});

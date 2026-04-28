import { describe, expect, it } from "vitest";

import { resolvePolicy, listJurisdictions, jurisdictionFor } from "../src/jurisdiction.js";

describe("jurisdiction resolver", () => {
  it("DPDP applies in India with asia-south1 residency", () => {
    const p = resolvePolicy("IN");
    expect(p.regulation.some((r) => r.includes("DPDP"))).toBe(true);
    expect(p.dataLocalisation).toContain("asia-south1");
    expect(p.breachNotificationHours).toBe(72);
    expect(p.dpoRequired).toBe(true);
  });

  it("EU GDPR + AI Act applies in EU with portability and Art 22", () => {
    const p = resolvePolicy("EU");
    expect(p.regulation.some((r) => r.includes("GDPR"))).toBe(true);
    expect(p.regulation.some((r) => r.includes("AI Act"))).toBe(true);
    expect(p.rightToPortability).toBe(true);
    expect(p.rightToObjectAutomatedDecision).toBe(true);
  });

  it("CCPA / CPRA in California requires sale opt-out", () => {
    const p = resolvePolicy("US-CA");
    expect(p.regulation).toContain("CCPA");
    expect(p.regulation).toContain("CPRA");
    expect(p.saleOptOutRequired).toBe(true);
  });

  it("UK falls back to ICO and UK GDPR", () => {
    const p = resolvePolicy("UK");
    expect(p.supervisoryAuthority).toContain("ICO");
    expect(p.regulation).toContain("UK GDPR");
  });

  it("listJurisdictions returns all six buckets", () => {
    const list = listJurisdictions();
    expect(list).toEqual(["IN", "US-CA", "US-other", "EU", "UK", "other"]);
  });

  it("jurisdictionFor maps country codes correctly", () => {
    expect(jurisdictionFor("IN")).toBe("IN");
    expect(jurisdictionFor("DE")).toBe("EU");
    expect(jurisdictionFor("US", "CA")).toBe("US-CA");
    expect(jurisdictionFor("US", "NY")).toBe("US-other");
    expect(jurisdictionFor("GB")).toBe("UK");
    expect(jurisdictionFor("BR")).toBe("other");
  });
});

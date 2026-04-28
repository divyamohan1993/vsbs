import { describe, it, expect } from "vitest";
import {
  lookupTellTale,
  tellTalesBySeverity,
  tellTaleCount,
  listTellTales,
} from "../src/iso2575.js";

describe("ISO 2575 tell-tale registry", () => {
  it("has at least 40 entries", () => {
    expect(tellTaleCount()).toBeGreaterThanOrEqual(40);
  });

  it("looks up canonical icons", () => {
    expect(lookupTellTale("ICON_OIL_PRESSURE_LOW")?.color).toBe("red");
    expect(lookupTellTale("ICON_BATTERY_CHARGE")?.color).toBe("red");
    expect(lookupTellTale("ICON_ABS")?.color).toBe("amber");
    expect(lookupTellTale("ICON_TPMS")?.color).toBe("amber");
    expect(lookupTellTale("ICON_HIGH_BEAM")?.color).toBe("blue");
    expect(lookupTellTale("ICON_FOG_LIGHTS_REAR")?.color).toBe("white");
  });

  it("returns null for unknown id", () => {
    expect(lookupTellTale("ICON_DOES_NOT_EXIST")).toBeNull();
  });

  it("filters by severity", () => {
    const sev3 = tellTalesBySeverity(3);
    expect(sev3.length).toBeGreaterThan(0);
    expect(sev3.every((t) => t.severity === 3)).toBe(true);
    expect(sev3.every((t) => t.color === "red")).toBe(true);
  });

  it("filters by colour and category", () => {
    const reds = listTellTales({ color: "red" });
    expect(reds.every((t) => t.color === "red" && t.category === "warning")).toBe(true);

    const indicators = listTellTales({ category: "indicator" });
    expect(indicators.length).toBeGreaterThan(0);
  });

  it("references ISO 2575 in every entry", () => {
    for (const t of listTellTales()) {
      expect(t.isoReference).toMatch(/ISO\s*\d+/);
    }
  });
});

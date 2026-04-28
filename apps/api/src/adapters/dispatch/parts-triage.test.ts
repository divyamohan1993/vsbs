import { describe, it, expect } from "vitest";
import { triageByParts } from "./parts-triage.js";
import { makeDemoInventory } from "../parts/inventory.js";

describe("triageByParts", () => {
  it("filters out service centres without parts in stock", () => {
    const inv = makeDemoInventory();
    const ranked = triageByParts(
      inv,
      [
        { scId: "SC-IN-DEL-01", wellbeing: 0.7, driveEtaMinutes: 20 },
        { scId: "SC-IN-DEL-02", wellbeing: 0.9, driveEtaMinutes: 10 },
      ],
      ["TESLA-COOL-KIT-M3-2024"],
    );
    expect(ranked.map((r) => r.scId)).toEqual(["SC-IN-DEL-01"]);
  });

  it("ranks higher wellbeing first when parts and ETA are comparable", () => {
    const inv = makeDemoInventory();
    const ranked = triageByParts(
      inv,
      [
        { scId: "SC-IN-DEL-01", wellbeing: 0.6, driveEtaMinutes: 12 },
        { scId: "SC-IN-DEL-03", wellbeing: 0.85, driveEtaMinutes: 12 },
      ],
      ["BOSCH-BP1234"],
    );
    expect(ranked[0]!.scId).toBe("SC-IN-DEL-03");
  });

  it("attaches a per-line rationale to every kept candidate", () => {
    const inv = makeDemoInventory();
    const ranked = triageByParts(
      inv,
      [{ scId: "SC-IN-DEL-01", wellbeing: 0.8, driveEtaMinutes: 8 }],
      ["BOSCH-0451103300"],
    );
    expect(ranked[0]!.rationale.length).toBeGreaterThanOrEqual(3);
    expect(ranked[0]!.availability.lines[0]!.code).toBe("BOSCH-0451103300");
  });

  it("returns an empty list when nobody has the parts", () => {
    const inv = makeDemoInventory();
    const ranked = triageByParts(
      inv,
      [{ scId: "SC-IN-DEL-01", wellbeing: 0.9, driveEtaMinutes: 5 }],
      ["NONEXISTENT-SKU"],
    );
    expect(ranked).toEqual([]);
  });

  it("composite score is bounded in [0, 1]", () => {
    const inv = makeDemoInventory();
    const ranked = triageByParts(
      inv,
      [
        { scId: "SC-IN-DEL-01", wellbeing: 1, driveEtaMinutes: 0 },
        { scId: "SC-IN-DEL-02", wellbeing: 0, driveEtaMinutes: 200 },
      ],
      ["EXIDE-MX-7"],
    );
    for (const r of ranked) {
      expect(r.composite).toBeGreaterThanOrEqual(0);
      expect(r.composite).toBeLessThanOrEqual(1);
    }
  });
});

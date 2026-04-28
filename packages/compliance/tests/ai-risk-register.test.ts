import { describe, expect, it } from "vitest";

import {
  AI_RISK_REGISTER,
  getAiRiskRegister,
  getRiskById,
  registerIntegrityReport,
} from "../src/ai-risk-register.js";

describe("AI risk register", () => {
  it("contains at least 18 rows", () => {
    expect(AI_RISK_REGISTER.length).toBeGreaterThanOrEqual(18);
  });

  it("has unique R-ids", () => {
    const ids = AI_RISK_REGISTER.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every row maps to one of the four NIST AI RMF categories", () => {
    const cats = new Set(AI_RISK_REGISTER.map((r) => r.category));
    for (const c of cats) {
      expect(["govern", "map", "measure", "manage"]).toContain(c);
    }
  });

  it("every row references at least one control", () => {
    for (const r of AI_RISK_REGISTER) {
      expect(r.controls.length).toBeGreaterThan(0);
    }
  });

  it("filters by category and status", () => {
    const open = getAiRiskRegister({ status: "open" });
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((r) => r.status === "open")).toBe(true);

    const measure = getAiRiskRegister({ category: "measure" });
    expect(measure.every((r) => r.category === "measure")).toBe(true);
  });

  it("getRiskById finds the safety hallucination row R19", () => {
    const r = getRiskById("R19");
    expect(r).toBeDefined();
    expect(r?.description.toLowerCase()).toContain("safety");
  });

  it("integrity report is consistent", () => {
    const rep = registerIntegrityReport();
    expect(rep.uniqueIds).toBe(true);
    expect(rep.total).toBe(AI_RISK_REGISTER.length);
    const sumCat = Object.values(rep.byCategory).reduce((a, b) => a + b, 0);
    expect(sumCat).toBe(rep.total);
  });
});

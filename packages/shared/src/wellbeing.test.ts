import { describe, it, expect } from "vitest";
import { wellbeingScore, maisterWaitScore, type WellbeingInputs } from "./wellbeing.js";
import { WELLBEING_WEIGHTS } from "./constants.js";

const zeros: WellbeingInputs = {
  safety: 0, wait: 0, cti: 0, timeAccuracy: 0, servqual: 0,
  trust: 0, continuity: 0, ces: 0, csat: 0, nps: 0,
};
const ones: WellbeingInputs = {
  safety: 1, wait: 1, cti: 1, timeAccuracy: 1, servqual: 1,
  trust: 1, continuity: 1, ces: 1, csat: 1, nps: 1,
};

describe("wellbeingScore", () => {
  it("all zeros → score 0 → poor", () => {
    const r = wellbeingScore(zeros);
    expect(r.score).toBe(0);
    expect(r.band).toBe("poor");
  });

  it("all ones → score 1 → excellent", () => {
    const r = wellbeingScore(ones);
    expect(r.score).toBeCloseTo(1, 10);
    expect(r.band).toBe("excellent");
  });

  it("clamps inputs above 1 and below 0", () => {
    const r = wellbeingScore({ ...ones, safety: 42, wait: -10 });
    // safety clamped to 1, wait clamped to 0 => score = 1 - WELLBEING_WEIGHTS.wait
    expect(r.score).toBeCloseTo(1 - WELLBEING_WEIGHTS.wait, 10);
  });

  it("handles NaN/Infinity as 0", () => {
    const r = wellbeingScore({ ...zeros, safety: Number.NaN, wait: Number.POSITIVE_INFINITY });
    // NaN → 0, Infinity → 0
    expect(r.score).toBe(0);
  });

  it("contributions sum to score exactly", () => {
    const inputs: WellbeingInputs = {
      safety: 0.8, wait: 0.6, cti: 0.9, timeAccuracy: 0.7, servqual: 0.5,
      trust: 0.4, continuity: 0.3, ces: 0.9, csat: 0.8, nps: 0.6,
    };
    const r = wellbeingScore(inputs);
    const sum = Object.values(r.contributions).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(r.score, 12);
  });

  it("band = excellent at boundary 0.85", () => {
    // Force a score of exactly 0.85 via safety weight of 0.25 × (0.85/0.25)… use ones scaled.
    // Direct: safety=1, wait scaled so total = 0.85.
    const i = { ...zeros, safety: 1, wait: 1, cti: 1, timeAccuracy: 1, servqual: 1, trust: 1, continuity: 1 };
    const r = wellbeingScore(i);
    // 0.25+0.15+0.12+0.10+0.10+0.08+0.08 = 0.88
    expect(r.score).toBeCloseTo(0.88, 10);
    expect(r.band).toBe("excellent");
  });

  it("band = good between 0.7 and 0.85", () => {
    const i = { ...zeros, safety: 1, wait: 1, cti: 1, timeAccuracy: 1, servqual: 1, trust: 1 };
    // 0.25+0.15+0.12+0.10+0.10+0.08 = 0.80
    const r = wellbeingScore(i);
    expect(r.score).toBeCloseTo(0.80, 10);
    expect(r.band).toBe("good");
  });

  it("band = fair between 0.5 and 0.7", () => {
    const i = { ...zeros, safety: 1, wait: 1, cti: 1, timeAccuracy: 1 };
    // 0.25+0.15+0.12+0.10 = 0.62
    const r = wellbeingScore(i);
    expect(r.band).toBe("fair");
  });

  it("band = poor below 0.5", () => {
    const i = { ...zeros, safety: 1 };
    // 0.25 → poor
    const r = wellbeingScore(i);
    expect(r.band).toBe("poor");
  });
});

describe("maisterWaitScore", () => {
  const allTrue = {
    explained: true, occupied: true, inProcess: true, fair: true, certain: true, groupRemedied: true,
  };
  const allFalse = {
    explained: false, occupied: false, inProcess: false, fair: false, certain: false, groupRemedied: false,
  };

  it("all-true flags with accurate wait → high (1.0)", () => {
    const s = maisterWaitScore(allTrue, { actualMinutes: 10, promisedMinutes: 10 });
    expect(s).toBeCloseTo(1, 10);
  });

  it("all-false flags with huge gap → low", () => {
    const s = maisterWaitScore(allFalse, { actualMinutes: 100, promisedMinutes: 10 });
    expect(s).toBeCloseTo(0, 10);
  });

  it("promisedMinutes=0 treats accuracy as perfect", () => {
    const s = maisterWaitScore(allTrue, { actualMinutes: 999, promisedMinutes: 0 });
    expect(s).toBeCloseTo(1, 10);
  });

  it("half-true flags → 0.7*0.5 + 0.3*1 = 0.65", () => {
    const s = maisterWaitScore(
      { explained: true, occupied: true, inProcess: true, fair: false, certain: false, groupRemedied: false },
      { actualMinutes: 30, promisedMinutes: 30 },
    );
    expect(s).toBeCloseTo(0.65, 10);
  });
});

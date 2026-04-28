import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assessSafety, postCheckSafetyAgrees, SAFETY_RED_FLAGS } from "./safety.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
interface RegressionCase {
  id: string;
  label: string;
  input: Parameters<typeof assessSafety>[0];
  expect: {
    severity: "red" | "amber" | "green";
    source?: "owner" | "sensor" | "both";
    containsTriggered?: string[];
    rationaleMatches?: string;
  };
}

const REG_FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, "../tests/fixtures/safety-regression.json"), "utf8"),
) as { cases: RegressionCase[] };

describe("assessSafety", () => {
  it("returns green when no signals reported", () => {
    const r = assessSafety({ owner: { canDriveSafely: "yes-confidently", redFlags: [] } });
    expect(r.severity).toBe("green");
    expect(r.triggered).toEqual([]);
  });

  it("yes-cautiously with no flags stays green", () => {
    const r = assessSafety({ owner: { canDriveSafely: "yes-cautiously" } });
    expect(r.severity).toBe("green");
  });

  it("owner brake-failure forces red + tow rationale", () => {
    const r = assessSafety({ owner: { canDriveSafely: "no", redFlags: ["brake-failure"] } });
    expect(r.severity).toBe("red");
    expect(r.triggered).toContain("brake-failure");
    expect(r.source).toBe("owner");
    expect(r.rationale).toMatch(/tow/i);
  });

  it("owner steering-failure forces red", () => {
    const r = assessSafety({ owner: { redFlags: ["steering-failure"] } });
    expect(r.severity).toBe("red");
  });

  it("owner engine-fire forces red", () => {
    const r = assessSafety({ owner: { redFlags: ["engine-fire"] } });
    expect(r.severity).toBe("red");
  });

  it("sensor brake-pressure-residual-critical forces red", () => {
    const r = assessSafety({ sensorFlags: ["brake-pressure-residual-critical"] });
    expect(r.severity).toBe("red");
    expect(r.source).toBe("sensor");
  });

  it("sensor hv-battery-dT-runaway forces red", () => {
    const r = assessSafety({ sensorFlags: ["hv-battery-dT-runaway"] });
    expect(r.severity).toBe("red");
  });

  it("both owner and sensor red flags → source=both", () => {
    const r = assessSafety({
      owner: { redFlags: ["engine-fire"] },
      sensorFlags: ["steering-assist-lost"],
    });
    expect(r.severity).toBe("red");
    expect(r.source).toBe("both");
    expect(r.triggered.length).toBe(2);
  });

  it("already-stranded forces red regardless of other flags", () => {
    const r = assessSafety({ owner: { canDriveSafely: "already-stranded" } });
    expect(r.severity).toBe("red");
    expect(r.triggered).toEqual(["already-stranded"]);
    expect(r.rationale).toMatch(/stranded/i);
  });

  it("canDriveSafely=unsure → amber with owner-unsure signal", () => {
    const r = assessSafety({ owner: { canDriveSafely: "unsure" } });
    expect(r.severity).toBe("amber");
    expect(r.triggered).toContain("owner-unsure");
  });

  it("canDriveSafely=no (without red flags) → amber", () => {
    const r = assessSafety({ owner: { canDriveSafely: "no", redFlags: [] } });
    expect(r.severity).toBe("amber");
    expect(r.triggered).toContain("owner-no");
  });

  it("non-red sensor flag → amber", () => {
    const r = assessSafety({ sensorFlags: ["tpms-low-front-left"] });
    expect(r.severity).toBe("amber");
    expect(r.source).toBe("sensor");
  });

  it("unknown owner flag is ignored", () => {
    const r = assessSafety({ owner: { canDriveSafely: "yes-confidently", redFlags: ["nonsense"] } });
    expect(r.severity).toBe("green");
  });

  it("SAFETY_RED_FLAGS contains all expected entries", () => {
    expect(SAFETY_RED_FLAGS.has("brake-failure")).toBe(true);
    expect(SAFETY_RED_FLAGS.has("airbag-deployed-recent")).toBe(true);
  });
});

describe("assessSafety — historical regression suite", () => {
  it.each(REG_FIXTURE.cases.map((c) => [c.id, c]))(
    "%s",
    (_id, kase) => {
      const result = assessSafety(kase.input);
      expect(result.severity).toBe(kase.expect.severity);
      if (kase.expect.source) expect(result.source).toBe(kase.expect.source);
      if (kase.expect.containsTriggered) {
        for (const t of kase.expect.containsTriggered) {
          expect(result.triggered).toContain(t);
        }
      }
      if (kase.expect.rationaleMatches) {
        expect(result.rationale.toLowerCase()).toContain(
          kase.expect.rationaleMatches.toLowerCase(),
        );
      }
    },
  );

  it("regression fixture contains at least 30 cases", () => {
    expect(REG_FIXTURE.cases.length).toBeGreaterThanOrEqual(30);
  });
});

describe("postCheckSafetyAgrees", () => {
  it("agrees with identical inputs (green)", () => {
    const raw = { owner: { canDriveSafely: "yes-confidently" as const, redFlags: [] } };
    const primary = assessSafety(raw);
    expect(postCheckSafetyAgrees(primary, raw)).toBe(true);
  });

  it("agrees with identical inputs (red, multiple flags)", () => {
    const raw = { owner: { redFlags: ["brake-failure", "engine-fire"] } };
    const primary = assessSafety(raw);
    expect(postCheckSafetyAgrees(primary, raw)).toBe(true);
  });

  it("rejects when severities mismatch", () => {
    const raw = { owner: { canDriveSafely: "yes-confidently" as const } };
    const primary = assessSafety(raw);
    const tampered = { owner: { canDriveSafely: "unsure" as const } };
    expect(postCheckSafetyAgrees(primary, tampered)).toBe(false);
  });

  it("rejects when triggered count mismatches", () => {
    const primary = assessSafety({ owner: { redFlags: ["brake-failure"] } });
    expect(postCheckSafetyAgrees(primary, { owner: { redFlags: ["brake-failure", "engine-fire"] } })).toBe(false);
  });
});

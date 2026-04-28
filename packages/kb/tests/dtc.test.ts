import { describe, it, expect } from "vitest";
import {
  lookupDtc,
  listDtcs,
  dtcCorpusSize,
  DTC_PROVENANCE,
} from "../src/dtc-corpus.js";

describe("DTC corpus", () => {
  it("contains at least 200 entries", () => {
    expect(dtcCorpusSize()).toBeGreaterThanOrEqual(200);
  });

  it("looks up known SAE generic codes", () => {
    expect(lookupDtc("P0010")?.description).toMatch(/camshaft/i);
    expect(lookupDtc("P0171")?.description).toMatch(/lean/i);
    expect(lookupDtc("P0300")?.description).toMatch(/misfire/i);
    expect(lookupDtc("P0420")?.description).toMatch(/catalyst/i);
    expect(lookupDtc("C0035")?.system).toBe("chassis");
    expect(lookupDtc("U0100")?.system).toBe("network");
  });

  it("is case-insensitive on lookup", () => {
    expect(lookupDtc("p0420")?.code).toBe("P0420");
    expect(lookupDtc("P0420")?.code).toBe("P0420");
  });

  it("returns null for an unknown code", () => {
    expect(lookupDtc("PFFFF")).toBeNull();
    expect(lookupDtc("")).toBeNull();
  });

  it("filters by system and severity", () => {
    const powertrain = listDtcs({ system: "powertrain" });
    expect(powertrain.length).toBeGreaterThan(0);
    expect(powertrain.every((e) => e.system === "powertrain")).toBe(true);

    const critical = listDtcs({ severity: "critical" });
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((e) => e.severity === "critical")).toBe(true);
  });

  it("provenance manifest is populated", () => {
    expect(DTC_PROVENANCE.source).toMatch(/SAE J2012-DA/);
    expect(DTC_PROVENANCE.version).toMatch(/J2012-DA/);
  });
});

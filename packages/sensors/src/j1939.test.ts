import { describe, it, expect } from "vitest";
import {
  J1939Driver,
  SPN_CATALOG,
  decodeSpn,
  encodeSpn,
  decodeFmi,
  parseDm1,
  encodeDm1,
  type J1939Transport,
} from "./j1939.js";

describe("decodeSpn round-trips for each of the 8 SPNs", () => {
  const cases: Array<{ spn: number; value: number; tol: number }> = [
    { spn: 84, value: 65.5, tol: 0.01 },
    { spn: 91, value: 50.0, tol: 0.4 },
    { spn: 96, value: 75.2, tol: 0.4 },
    { spn: 100, value: 400, tol: 4 },
    { spn: 110, value: 95, tol: 1 },
    { spn: 168, value: 28.0, tol: 0.05 },
    { spn: 190, value: 1500, tol: 0.125 },
    { spn: 247, value: 12345.5, tol: 0.05 },
  ];
  for (const tc of cases) {
    it(`SPN ${tc.spn} (${SPN_CATALOG[tc.spn]!.name}) encodes and decodes`, () => {
      const raw = encodeSpn(tc.spn, tc.value);
      const decoded = decodeSpn(tc.spn, raw);
      expect(decoded).toBeDefined();
      expect(Math.abs((decoded as number) - tc.value)).toBeLessThanOrEqual(tc.tol);
    });
  }
});

describe("decodeSpn returns undefined for not-available patterns", () => {
  it("1-byte 0xFF is not-available", () => {
    expect(decodeSpn(91, new Uint8Array([0xff]))).toBeUndefined();
  });
  it("2-byte 0xFFFF is not-available", () => {
    expect(decodeSpn(190, new Uint8Array([0xff, 0xff]))).toBeUndefined();
  });
});

describe("decodeFmi", () => {
  it("FMI 0 = data-valid-but-above-normal", () => {
    expect(decodeFmi(0)).toBe("data-valid-but-above-normal");
  });
  it("FMI 1 = data-valid-but-below-normal", () => {
    expect(decodeFmi(1)).toBe("data-valid-but-below-normal");
  });
  it("FMI 2 = data-erratic-or-incorrect", () => {
    expect(decodeFmi(2)).toBe("data-erratic-or-incorrect");
  });
  it("FMI 8 = abnormal-frequency-or-pwm", () => {
    expect(decodeFmi(8)).toBe("abnormal-frequency-or-pwm");
  });
});

describe("DM1 round-trip", () => {
  it("encodes and decodes 3 faults with mixed FMIs and OCs", () => {
    const faults = [
      { spn: 100, fmi: 1, fmiLabel: "data-valid-but-below-normal", occurrenceCount: 7, conversionMethod: 0 as const },
      { spn: 110, fmi: 0, fmiLabel: "data-valid-but-above-normal", occurrenceCount: 3, conversionMethod: 0 as const },
      { spn: 168, fmi: 4, fmiLabel: "voltage-below-normal-or-short-to-low", occurrenceCount: 12, conversionMethod: 1 as const },
    ];
    const raw = encodeDm1(faults, 0x55);
    const parsed = parseDm1(raw);
    expect(parsed.lampStatus).toBe(0x55);
    expect(parsed.faults.length).toBe(3);
    for (let i = 0; i < faults.length; i++) {
      expect(parsed.faults[i]!.spn).toBe(faults[i]!.spn);
      expect(parsed.faults[i]!.fmi).toBe(faults[i]!.fmi);
      expect(parsed.faults[i]!.occurrenceCount).toBe(faults[i]!.occurrenceCount);
      expect(parsed.faults[i]!.conversionMethod).toBe(faults[i]!.conversionMethod);
    }
  });
});

describe("J1939Driver sim mode", () => {
  it("emits one sample per supported SPN, all stamped origin=sim", async () => {
    const drv = new J1939Driver({ mode: "sim", vehicleId: "truck-1" });
    const batch = await drv.readBatch();
    expect(batch.length).toBe(8);
    for (const s of batch) {
      expect(s.origin).toBe("sim");
      expect(s.vehicleId).toBe("truck-1");
    }
    const names = batch.map((s) => (s.value as { name: string }).name).sort();
    expect(names).toEqual([
      "acceleratorPedalPct",
      "batteryPotentialV",
      "engineCoolantTempC",
      "engineOilPressureKpa",
      "engineSpeedRpm",
      "engineTotalHours",
      "fuelLevelPct",
      "vehicleSpeedKph",
    ]);
  });

  it("readDm1 in sim returns no faults", async () => {
    const drv = new J1939Driver({ mode: "sim", vehicleId: "truck-1" });
    const dm1 = await drv.readDm1();
    expect(dm1.faults).toEqual([]);
  });
});

describe("J1939Driver live mode requires a transport", () => {
  it("throws when no transport is configured", async () => {
    const drv = new J1939Driver({ mode: "live", vehicleId: "truck-2" });
    await expect(drv.readBatch()).rejects.toThrow(/transport/);
    await expect(drv.readDm1()).rejects.toThrow(/transport/);
  });

  it("uses the transport when one is provided", async () => {
    // The driver maps each SPN to a per-SPN PGN. The test transport keeps a
    // running cursor so each call returns the next SPN's encoded payload in
    // the order the driver iterates SUPPORTED_SPNS.
    const order = [84, 91, 96, 100, 110, 168, 190, 247];
    let cursor = 0;
    const transport: J1939Transport = {
      open: async () => {},
      close: async () => {},
      readDm1: async () =>
        encodeDm1(
          [{
            spn: 100, fmi: 1, fmiLabel: "data-valid-but-below-normal",
            occurrenceCount: 1, conversionMethod: 0,
          }],
          0x10,
        ),
      readPgn: async (_pgn: number) => {
        const spn = order[cursor++]!;
        return encodeSpn(spn, midDomain(spn));
      },
    };
    const drv = new J1939Driver({ mode: "live", vehicleId: "truck-3", transport });
    const batch = await drv.readBatch();
    expect(batch.length).toBe(8);
    for (const s of batch) expect(s.origin).toBe("real");
    const dm1 = await drv.readDm1();
    expect(dm1.faults.length).toBe(1);
    expect(dm1.faults[0]!.spn).toBe(100);
    expect(dm1.faults[0]!.fmi).toBe(1);
  });
});

function midDomain(spn: number): number {
  const d = SPN_CATALOG[spn]!;
  return (d.min + d.max) / 2;
}



import { decodeElmLine, makeSimSource, pidToSensorSample, __test__ } from "../src/lib/ble-obd";

describe("ELM327 line parser", () => {
  it("decodes 41 0C (RPM) per SAE J1979", () => {
    // 41 0C 1A F8 -> (0x1A * 256 + 0xF8) / 4 = 1726
    const r = decodeElmLine("41 0C 1A F8");
    expect(r).toEqual({ pid: "0C", kind: "rpm", value: 1726, unit: "rpm" });
  });

  it("decodes 41 0D (speed)", () => {
    const r = decodeElmLine("41 0D 50");
    expect(r).toEqual({ pid: "0D", kind: "speed", value: 0x50, unit: "km/h" });
  });

  it("decodes 41 05 (coolant) with -40 offset", () => {
    const r = decodeElmLine("41 05 5A");
    expect(r).toEqual({ pid: "05", kind: "coolant", value: 0x5a - 40, unit: "C" });
  });

  it("returns null on noise / invalid lines", () => {
    expect(decodeElmLine("BUSINIT: ERROR")).toBeNull();
    expect(decodeElmLine("?")).toBeNull();
    expect(decodeElmLine("")).toBeNull();
    expect(decodeElmLine("41 ZZ 00")).toBeNull();
  });

  it("ignores echo > prompt and CR/LF", () => {
    const r = decodeElmLine(">41 0D 50\r");
    expect(r?.kind).toBe("speed");
  });

  it("makeSimSource emits all 8 PIDs each tick", () => {
    const src = makeSimSource({ vehicleId: "v-1", intervalMs: 1000 });
    const samples = src.next();
    expect(samples).toHaveLength(8);
    for (const s of samples) {
      expect(s.channel).toBe("obd-pid");
      expect(s.origin).toBe("sim");
      expect(s.vehicleId).toBe("v-1");
    }
  });

  it("pidToSensorSample stamps origin", () => {
    const s = pidToSensorSample({
      decoded: { pid: "0D", kind: "speed", value: 60, unit: "km/h" },
      vehicleId: "abc",
      origin: "real",
    });
    expect(s.origin).toBe("real");
    expect(s.channel).toBe("obd-pid");
  });

  it("internal __test__ exposes decoder for direct testing", () => {
    expect(typeof __test__.decodeElmLine).toBe("function");
  });
});

// =============================================================================
// SAE J1939 driver scaffold for heavy-duty CAN.
//
// J1939 is the CAN-bus protocol family used in commercial trucks, buses,
// agricultural equipment, and military vehicles. Unlike light-duty OBD-II
// (SAE J1979), J1939 frames carry a 29-bit identifier that decomposes into
// (Priority, Reserved, Data Page, PDU Format, PDU Specific, Source Address)
// per SAE J1939-21. Faults are reported through the DM1 (active) and DM2
// (previously active) PGN messages with a 4-byte body containing
// (SPN [19 bits] + FMI [5 bits] + Conversion Method [1 bit] + Occurrence
// Counter [7 bits]).
//
// SPN = Suspect Parameter Number; identifies *what* is wrong.
// FMI = Failure Mode Identifier (J1939-73); identifies *how* it is wrong.
//
// This driver ships:
//   - Decoders for 8 representative SPNs in light commercial fleets:
//       SPN 84  Vehicle speed
//       SPN 91  Accelerator pedal position
//       SPN 96  Fuel level
//       SPN 100 Engine oil pressure
//       SPN 110 Engine coolant temperature
//       SPN 168 Battery potential
//       SPN 190 Engine speed (RPM)
//       SPN 247 Engine total hours of operation
//   - FMI decoders for the 4 most-common fault classes:
//       FMI 0  Data valid but above normal operational range
//       FMI 1  Data valid but below normal operational range
//       FMI 2  Data erratic, intermittent or incorrect
//       FMI 4  Voltage below normal or shorted to low source
//   - DM1 frame parsing: extract (SPN, FMI, OC) tuples.
//   - A sim driver that walks the same SensorSample-emitting state machine
//     as the OBD-II dongle adapter (origin: "sim").
//   - A live driver hook that throws a clear error if no CAN backend has
//     been configured (the live wiring is the next phase's J1939-91 socket
//     work; live SocketCAN integration is intentionally out of scope here).
//
// References:
//   SAE J1939-21 §5.2 (PGN structure), J1939-71 §5 (SPN catalog),
//   J1939-73 §5.7 (DM1 message), TMC RP-1210 §3.4 (driver-level API).
// =============================================================================

import type { SensorSample } from "@vsbs/shared";
import { mulberry32 } from "@vsbs/shared";

// ---------------------------------------------------------------------------
// SPN catalog. The "raw" -> "engineering" decoders are quoted directly from
// the SAE J1939-71 SPN tables. Values are deterministic; if you change one,
// add a citation.
// ---------------------------------------------------------------------------

export interface SpnDescriptor {
  spn: number;
  name: string;
  unit: string;
  /** Number of data bytes (1 or 2 for the SPNs we cover). */
  bytes: 1 | 2 | 4;
  /** Engineering value = raw * scale + offset. */
  scale: number;
  offset: number;
  /** Domain hints for downstream histogram / plausibility checks. */
  min: number;
  max: number;
}

export const SPN_CATALOG: Record<number, SpnDescriptor> = {
  84: {
    spn: 84,
    name: "vehicleSpeedKph",
    unit: "kph",
    bytes: 2,
    scale: 1 / 256,
    offset: 0,
    min: 0,
    max: 250.996,
  },
  91: {
    spn: 91,
    name: "acceleratorPedalPct",
    unit: "%",
    bytes: 1,
    scale: 0.4,
    offset: 0,
    min: 0,
    max: 100,
  },
  96: {
    spn: 96,
    name: "fuelLevelPct",
    unit: "%",
    bytes: 1,
    scale: 0.4,
    offset: 0,
    min: 0,
    max: 100,
  },
  100: {
    spn: 100,
    name: "engineOilPressureKpa",
    unit: "kPa",
    bytes: 1,
    scale: 4,
    offset: 0,
    min: 0,
    max: 1000,
  },
  110: {
    spn: 110,
    name: "engineCoolantTempC",
    unit: "C",
    bytes: 1,
    scale: 1,
    offset: -40,
    min: -40,
    max: 215,
  },
  168: {
    spn: 168,
    name: "batteryPotentialV",
    unit: "V",
    bytes: 2,
    scale: 0.05,
    offset: 0,
    min: 0,
    max: 3212.75,
  },
  190: {
    spn: 190,
    name: "engineSpeedRpm",
    unit: "rpm",
    bytes: 2,
    scale: 0.125,
    offset: 0,
    min: 0,
    max: 8031.875,
  },
  247: {
    spn: 247,
    name: "engineTotalHours",
    unit: "h",
    bytes: 4,
    scale: 0.05,
    offset: 0,
    min: 0,
    max: 210554060.75,
  },
};

export const SUPPORTED_SPNS = Object.keys(SPN_CATALOG)
  .map((s) => Number.parseInt(s, 10))
  .sort((a, b) => a - b);

/**
 * Decode raw J1939 bytes for an SPN into the engineering value. Returns
 * undefined if the value is the J1939 "not available" or "error" pattern
 * (all 0xFE / 0xFF in the most-significant byte of the data field).
 */
export function decodeSpn(spn: number, raw: Uint8Array): number | undefined {
  const desc = SPN_CATALOG[spn];
  if (!desc) throw new Error(`unsupported SPN ${spn}`);
  if (raw.length < desc.bytes) {
    throw new Error(`decodeSpn: need ${desc.bytes} bytes, got ${raw.length}`);
  }
  let rawValue = 0;
  if (desc.bytes === 1) {
    rawValue = raw[0]!;
    if (rawValue === 0xfe || rawValue === 0xff) return undefined;
  } else if (desc.bytes === 2) {
    // J1939 is little-endian on the bus.
    rawValue = raw[0]! | (raw[1]! << 8);
    if (rawValue === 0xfaff || rawValue === 0xfbff || rawValue >= 0xfb00) {
      // 0xFB00..0xFFFF reserved for error / not available patterns.
      return undefined;
    }
  } else {
    rawValue = raw[0]! | (raw[1]! << 8) | (raw[2]! << 16) | (raw[3]! << 24);
    if (rawValue >= 0xfb000000) return undefined;
  }
  return rawValue * desc.scale + desc.offset;
}

// ---------------------------------------------------------------------------
// FMI decoder. We support 0/1/2/4 explicitly; other codes fall through to
// a labelled "unspecified" string so callers can still display them.
// ---------------------------------------------------------------------------

export const FMI_CATALOG: Record<number, string> = {
  0: "data-valid-but-above-normal",
  1: "data-valid-but-below-normal",
  2: "data-erratic-or-incorrect",
  3: "voltage-above-normal-or-short-to-high",
  4: "voltage-below-normal-or-short-to-low",
  5: "current-below-normal-or-open-circuit",
  6: "current-above-normal-or-grounded-circuit",
  7: "mechanical-system-not-responding",
  8: "abnormal-frequency-or-pwm",
  9: "abnormal-update-rate",
  10: "abnormal-rate-of-change",
  11: "root-cause-unknown",
  12: "bad-intelligent-device-or-component",
  13: "out-of-calibration",
  14: "special-instructions",
  15: "data-valid-but-above-least-severe",
  31: "condition-exists",
};

export function decodeFmi(fmi: number): string {
  return FMI_CATALOG[fmi] ?? `fmi-${fmi}-unspecified`;
}

// ---------------------------------------------------------------------------
// DM1 (active diagnostic trouble code) frame.
// PGN 65226 / 0xFECA. Each fault tuple is 4 bytes:
//   byte0 : SPN low 8 bits
//   byte1 : SPN middle 8 bits
//   byte2 : SPN high 3 bits in [7..5], FMI in [4..0]
//   byte3 : CM in [7], occurrence count in [6..0]
// J1939-73 §5.7.1.
// ---------------------------------------------------------------------------

export interface Dm1Fault {
  spn: number;
  fmi: number;
  fmiLabel: string;
  occurrenceCount: number;
  conversionMethod: 0 | 1;
}

export interface Dm1Frame {
  /** Lamp status byte (J1939-73 §5.7.1, the prefix before the fault list). */
  lampStatus: number;
  faults: Dm1Fault[];
}

export function parseDm1(raw: Uint8Array): Dm1Frame {
  if (raw.length < 2) {
    throw new Error("parseDm1: frame too short");
  }
  // First two bytes: lamp statuses (we keep one combined).
  const lampStatus = raw[0]!;
  const faults: Dm1Fault[] = [];
  for (let i = 2; i + 3 < raw.length; i += 4) {
    const b0 = raw[i]!;
    const b1 = raw[i + 1]!;
    const b2 = raw[i + 2]!;
    const b3 = raw[i + 3]!;
    if (b0 === 0xff && b1 === 0xff && b2 === 0xff && b3 === 0xff) break;
    const spn = b0 | (b1 << 8) | ((b2 >> 5) & 0x07) << 16;
    const fmi = b2 & 0x1f;
    const cm = ((b3 >> 7) & 0x01) as 0 | 1;
    const oc = b3 & 0x7f;
    faults.push({
      spn,
      fmi,
      fmiLabel: decodeFmi(fmi),
      occurrenceCount: oc,
      conversionMethod: cm,
    });
  }
  return { lampStatus, faults };
}

// ---------------------------------------------------------------------------
// CAN backend hook. Live mode wires this to a SocketCAN file descriptor or
// a vendor RP-1210 binding; sim mode never touches it.
// ---------------------------------------------------------------------------

export interface J1939Transport {
  open(): Promise<void>;
  /** Read the next DM1 frame from the bus. */
  readDm1(): Promise<Uint8Array>;
  /** Read the latest data frame for a given PGN. */
  readPgn(pgn: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// J1939 driver. Same shape as the OBD-II adapter (mode, vehicleId, batch
// poll → SensorSample[]). Sim mode emits plausible data through a seeded
// RNG. Live mode requires a transport; if absent, throws.
// ---------------------------------------------------------------------------

export interface J1939DriverConfig {
  mode: "sim" | "live";
  vehicleId: string;
  transport?: J1939Transport;
  simSeed?: number;
}

export class J1939Driver {
  readonly mode: "sim" | "live";
  readonly vehicleId: string;
  readonly #cfg: J1939DriverConfig;
  readonly #rng: () => number;

  constructor(cfg: J1939DriverConfig) {
    this.#cfg = cfg;
    this.mode = cfg.mode;
    this.vehicleId = cfg.vehicleId;
    this.#rng = mulberry32(cfg.simSeed ?? 0xb1939);
  }

  async readBatch(): Promise<SensorSample[]> {
    if (this.mode === "live") {
      if (!this.#cfg.transport) {
        throw new Error(
          "j1939 live mode not implemented; configure a CAN transport (SocketCAN / RP-1210)",
        );
      }
      return this.#liveBatch(this.#cfg.transport);
    }
    return this.#simBatch();
  }

  async readDm1(): Promise<Dm1Frame> {
    if (this.mode === "live") {
      if (!this.#cfg.transport) {
        throw new Error(
          "j1939 live mode not implemented; configure a CAN transport (SocketCAN / RP-1210)",
        );
      }
      const raw = await this.#cfg.transport.readDm1();
      return parseDm1(raw);
    }
    return { lampStatus: 0, faults: [] };
  }

  #simBatch(): SensorSample[] {
    const now = new Date().toISOString();
    const r = this.#rng;
    const samples: SensorSample[] = [];
    samples.push(this.#sample(now, "vehicleSpeedKph", 60 + r() * 20));
    samples.push(this.#sample(now, "acceleratorPedalPct", 30 + r() * 30));
    samples.push(this.#sample(now, "fuelLevelPct", 50 + r() * 30));
    samples.push(this.#sample(now, "engineOilPressureKpa", 380 + r() * 60));
    samples.push(this.#sample(now, "engineCoolantTempC", 85 + r() * 6));
    samples.push(this.#sample(now, "batteryPotentialV", 27.5 + r() * 0.6));
    samples.push(this.#sample(now, "engineSpeedRpm", 1500 + r() * 200));
    samples.push(this.#sample(now, "engineTotalHours", 12345.5));
    return samples;
  }

  async #liveBatch(t: J1939Transport): Promise<SensorSample[]> {
    const now = new Date().toISOString();
    const out: SensorSample[] = [];
    for (const spn of SUPPORTED_SPNS) {
      const desc = SPN_CATALOG[spn]!;
      // Each SPN lives on its own PGN in production fleets; in this scaffold
      // we round-trip a synthetic PGN (0xFEF0 + SPN low byte) so the live
      // wiring keeps the same per-SPN call shape.
      const pgn = 0xfef0 + (spn & 0xff);
      const raw = await t.readPgn(pgn);
      const value = decodeSpn(spn, raw);
      if (value === undefined) continue;
      out.push({
        channel: "obd-pid",
        timestamp: now,
        origin: "real",
        vehicleId: this.vehicleId,
        value: { spn, name: desc.name, value, unit: desc.unit },
        health: { selfTestOk: true, trust: 0.9 },
      });
    }
    return out;
  }

  #sample(timestamp: string, name: string, value: number): SensorSample {
    const desc = Object.values(SPN_CATALOG).find((d) => d.name === name);
    if (!desc) throw new Error(`internal: unknown SPN name ${name}`);
    return {
      channel: "obd-pid",
      timestamp,
      origin: "sim",
      vehicleId: this.vehicleId,
      value: { spn: desc.spn, name, value, unit: desc.unit },
      health: { selfTestOk: true, trust: 0.9 },
    };
  }
}

// ---------------------------------------------------------------------------
// Encoder helpers — used by tests and by the sim driver to materialise
// realistic raw frames a downstream decoder will round-trip cleanly.
// ---------------------------------------------------------------------------

export function encodeSpn(spn: number, value: number): Uint8Array {
  const desc = SPN_CATALOG[spn];
  if (!desc) throw new Error(`unsupported SPN ${spn}`);
  const raw = Math.round((value - desc.offset) / desc.scale);
  const out = new Uint8Array(desc.bytes);
  if (desc.bytes === 1) {
    out[0] = raw & 0xff;
  } else if (desc.bytes === 2) {
    out[0] = raw & 0xff;
    out[1] = (raw >> 8) & 0xff;
  } else {
    out[0] = raw & 0xff;
    out[1] = (raw >> 8) & 0xff;
    out[2] = (raw >> 16) & 0xff;
    out[3] = (raw >>> 24) & 0xff;
  }
  return out;
}

export function encodeDm1(faults: Dm1Fault[], lampStatus = 0): Uint8Array {
  // 2-byte lamp prefix + 4 bytes per fault.
  const out = new Uint8Array(2 + faults.length * 4);
  out[0] = lampStatus & 0xff;
  out[1] = 0xff; // reserved second lamp byte
  for (let i = 0; i < faults.length; i++) {
    const f = faults[i]!;
    const idx = 2 + i * 4;
    out[idx] = f.spn & 0xff;
    out[idx + 1] = (f.spn >> 8) & 0xff;
    out[idx + 2] = (((f.spn >> 16) & 0x07) << 5) | (f.fmi & 0x1f);
    out[idx + 3] = ((f.conversionMethod & 0x1) << 7) | (f.occurrenceCount & 0x7f);
  }
  return out;
}

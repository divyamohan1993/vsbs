// =============================================================================
// BLE OBD-II ingestion. Talks to ELM327-class dongles (and the
// vLinker MS / OBDLink LX which expose the same AT command set) and
// streams parsed PIDs into the @vsbs/sensors `SensorSample` shape.
//
// Protocol references:
//   - SAE J1979 (E/85 OBD-II diagnostic test modes + standard PIDs).
//   - ISO 15765-4 (CAN bus diagnostics over OBD-II).
//   - ELM327 datasheet rev 2.3 (AT command vocabulary).
//
// Wake sequence (verbatim from ELM327 datasheet §4):
//   AT Z       reset device, wait 1s for "ELM327 v..."
//   AT E0      echo off
//   AT L0      linefeeds off
//   AT S0      strip whitespace from responses
//   AT SP 0    auto-detect protocol
//
// Then a polling loop sends Mode 01 + PID hex strings:
//   01 0C  →  engine RPM
//   01 0D  →  vehicle speed (km/h)
//   01 05  →  coolant temp (°C)
//   01 04  →  calculated load (%)
//   01 11  →  throttle position (%)
//   01 2F  →  fuel level (%)
//   01 33  →  barometric pressure (kPa)
//   01 0F  →  intake air temp (°C)
//
// Each ECU reply has the form `41 XX YY ZZ` where 41 = 0x40 + 0x01 (Mode
// 01 response), XX is the PID echo, and the remaining bytes are the data.
// Decoder formulas are SAE J1979 §6.5 verbatim.
//
// Sim mode: when EXPO_PUBLIC_BLE=sim or no peripheral is connected, we
// emit synthetic samples on a 1 Hz cadence so the rest of the pipeline
// still exercises end to end.
// =============================================================================

import type { SensorSample } from "@vsbs/shared";

const ELM327_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
const ELM327_NOTIFY_UUID = "0000fff1-0000-1000-8000-00805f9b34fb";
const ELM327_WRITE_UUID = "0000fff2-0000-1000-8000-00805f9b34fb";

const WAKE_COMMANDS = ["ATZ", "ATE0", "ATL0", "ATS0", "ATSP0"] as const;

const POLL_PIDS = [
  { pid: "0C", kind: "rpm" as const },
  { pid: "0D", kind: "speed" as const },
  { pid: "05", kind: "coolant" as const },
  { pid: "04", kind: "load" as const },
  { pid: "11", kind: "throttle" as const },
  { pid: "2F", kind: "fuelLevel" as const },
  { pid: "33", kind: "baro" as const },
  { pid: "0F", kind: "intakeTemp" as const },
];

export interface DecodedPid {
  pid: string;
  kind: (typeof POLL_PIDS)[number]["kind"];
  value: number;
  unit: string;
}

/**
 * Decode one ECU response (a hex-text ELM327 line such as "41 0C 1A F8").
 * Returns null if the line is not a valid Mode 01 response or the PID is
 * not in our list.
 */
export function decodeElmLine(line: string): DecodedPid | null {
  const tokens = line
    .toUpperCase()
    .replace(/[\r>]+/g, "")
    .trim()
    .split(/\s+/)
    .filter((t) => /^[0-9A-F]{1,2}$/.test(t));
  if (tokens.length < 3) return null;
  if (tokens[0] !== "41") return null;
  const pid = tokens[1]!.padStart(2, "0");
  const a = tokens[2] !== undefined ? parseInt(tokens[2], 16) : Number.NaN;
  const b = tokens[3] !== undefined ? parseInt(tokens[3], 16) : Number.NaN;
  switch (pid) {
    case "0C": {
      if (Number.isNaN(a) || Number.isNaN(b)) return null;
      return { pid, kind: "rpm", value: (a * 256 + b) / 4, unit: "rpm" };
    }
    case "0D": {
      if (Number.isNaN(a)) return null;
      return { pid, kind: "speed", value: a, unit: "km/h" };
    }
    case "05": {
      if (Number.isNaN(a)) return null;
      return { pid, kind: "coolant", value: a - 40, unit: "C" };
    }
    case "04": {
      if (Number.isNaN(a)) return null;
      return { pid, kind: "load", value: (a * 100) / 255, unit: "%" };
    }
    case "11": {
      if (Number.isNaN(a)) return null;
      return { pid, kind: "throttle", value: (a * 100) / 255, unit: "%" };
    }
    case "2F": {
      if (Number.isNaN(a)) return null;
      return { pid, kind: "fuelLevel", value: (a * 100) / 255, unit: "%" };
    }
    case "33": {
      if (Number.isNaN(a)) return null;
      return { pid, kind: "baro", value: a, unit: "kPa" };
    }
    case "0F": {
      if (Number.isNaN(a)) return null;
      return { pid, kind: "intakeTemp", value: a - 40, unit: "C" };
    }
    default:
      return null;
  }
}

export function pidToSensorSample(opts: {
  decoded: DecodedPid;
  vehicleId: string;
  origin: "real" | "sim";
}): SensorSample {
  return {
    channel: "obd-pid",
    timestamp: new Date().toISOString(),
    origin: opts.origin,
    vehicleId: opts.vehicleId,
    value: {
      pid: opts.decoded.pid,
      kind: opts.decoded.kind,
      value: opts.decoded.value,
      unit: opts.decoded.unit,
    },
    health: { selfTestOk: true, trust: 1 },
  };
}

// ---------- Sim source ----------

/**
 * Deterministic simulator. Produces realistic-shaped values that drift
 * with a sinusoid + small Gaussian noise so the EKF in @vsbs/sensors has
 * something to consume during demo mode.
 */
export function makeSimSource(opts: { vehicleId: string; intervalMs?: number }) {
  let t = 0;
  return {
    next(): SensorSample[] {
      t += opts.intervalMs ?? 1000;
      const seconds = t / 1000;
      const samples: SensorSample[] = [];
      for (const { pid, kind } of POLL_PIDS) {
        let value: number;
        let unit: string;
        switch (kind) {
          case "rpm":
            value = 800 + 600 * Math.sin(seconds / 5) + 50 * Math.sin(seconds * 3);
            unit = "rpm";
            break;
          case "speed":
            value = Math.max(0, 40 + 20 * Math.sin(seconds / 8));
            unit = "km/h";
            break;
          case "coolant":
            value = 88 + 2 * Math.sin(seconds / 30);
            unit = "C";
            break;
          case "load":
            value = 25 + 10 * Math.sin(seconds / 4);
            unit = "%";
            break;
          case "throttle":
            value = 18 + 5 * Math.sin(seconds / 3);
            unit = "%";
            break;
          case "fuelLevel":
            value = Math.max(5, 60 - seconds * 0.001);
            unit = "%";
            break;
          case "baro":
            value = 100 + 0.5 * Math.sin(seconds / 60);
            unit = "kPa";
            break;
          case "intakeTemp":
            value = 30 + 5 * Math.sin(seconds / 20);
            unit = "C";
            break;
        }
        samples.push(
          pidToSensorSample({
            decoded: { pid, kind, value, unit },
            vehicleId: opts.vehicleId,
            origin: "sim",
          }),
        );
      }
      return samples;
    },
  };
}

// ---------- Live BLE source ----------

export interface ObdSource {
  start(handler: (samples: SensorSample[]) => void): Promise<void>;
  stop(): Promise<void>;
}

interface BleManagerLike {
  startDeviceScan(
    serviceUUIDs: string[] | null,
    options: unknown,
    callback: (error: Error | null, device: BleDeviceLike | null) => void,
  ): void;
  stopDeviceScan(): void;
  destroy(): void;
}

interface BleDeviceLike {
  id: string;
  name: string | null;
  connect(): Promise<BleDeviceLike>;
  discoverAllServicesAndCharacteristics(): Promise<BleDeviceLike>;
  writeCharacteristicWithResponseForService(
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string,
  ): Promise<unknown>;
  monitorCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
    cb: (error: Error | null, characteristic: { value: string | null } | null) => void,
  ): { remove(): void };
  cancelConnection(): Promise<unknown>;
}

function decodeBase64Ascii(b64: string): string {
  const bin = atob(b64);
  return bin;
}

function encodeAsciiBase64(s: string): string {
  let bin = "";
  for (let i = 0; i < s.length; i++) bin += String.fromCharCode(s.charCodeAt(i) & 0xff);
  return btoa(bin);
}

/**
 * Live BLE OBD source. Caller injects the BleManager so we don't import
 * `react-native-ble-plx` at module-evaluation time; the test environment
 * never spins this up. Real callers do:
 *
 *   import { BleManager } from "react-native-ble-plx";
 *   const src = makeLiveSource({ manager: new BleManager(), vehicleId });
 */
export function makeLiveSource(opts: {
  manager: BleManagerLike;
  vehicleId: string;
  pollIntervalMs?: number;
}): ObdSource {
  let device: BleDeviceLike | null = null;
  let monitor: { remove(): void } | null = null;
  let buffer = "";
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let pidIndex = 0;
  let stopped = false;

  async function send(cmd: string): Promise<void> {
    if (!device) return;
    await device.writeCharacteristicWithResponseForService(
      ELM327_SERVICE_UUID,
      ELM327_WRITE_UUID,
      encodeAsciiBase64(`${cmd}\r`),
    );
  }

  return {
    async start(handler) {
      stopped = false;
      device = await new Promise<BleDeviceLike>((resolve, reject) => {
        opts.manager.startDeviceScan([ELM327_SERVICE_UUID], null, (err, d) => {
          if (err) {
            opts.manager.stopDeviceScan();
            reject(err);
            return;
          }
          if (d && (d.name?.toUpperCase().includes("OBD") || d.name?.toUpperCase().includes("ELM"))) {
            opts.manager.stopDeviceScan();
            resolve(d);
          }
        });
        setTimeout(() => {
          opts.manager.stopDeviceScan();
          reject(new Error("BLE scan timeout — no ELM327 dongle found"));
        }, 15_000);
      });

      device = await device.connect();
      device = await device.discoverAllServicesAndCharacteristics();

      monitor = device.monitorCharacteristicForService(
        ELM327_SERVICE_UUID,
        ELM327_NOTIFY_UUID,
        (err, c) => {
          if (err || !c?.value) return;
          buffer += decodeBase64Ascii(c.value);
          let idx: number;
          while ((idx = buffer.indexOf(">")) >= 0) {
            const frame = buffer.slice(0, idx).replace(/[\r\n]+/g, "\n");
            buffer = buffer.slice(idx + 1);
            for (const line of frame.split("\n")) {
              const decoded = decodeElmLine(line);
              if (decoded) {
                handler([
                  pidToSensorSample({ decoded, vehicleId: opts.vehicleId, origin: "real" }),
                ]);
              }
            }
          }
        },
      );

      for (const cmd of WAKE_COMMANDS) {
        await send(cmd);
        await new Promise((r) => setTimeout(r, 250));
      }

      pollHandle = setInterval(async () => {
        if (stopped) return;
        const next = POLL_PIDS[pidIndex % POLL_PIDS.length]!;
        pidIndex++;
        try {
          await send(`01${next.pid}`);
        } catch {
          /* swallow — next tick will retry */
        }
      }, opts.pollIntervalMs ?? 200);
    },

    async stop() {
      stopped = true;
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
      if (monitor) {
        monitor.remove();
        monitor = null;
      }
      if (device) {
        try {
          await device.cancelConnection();
        } catch {
          /* device already disconnected */
        }
        device = null;
      }
    },
  };
}

export const __test__ = { decodeElmLine };

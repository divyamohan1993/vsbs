// =============================================================================
// OBD-II Diagnostic Trouble Code corpus.
//
// Codes follow SAE J2012-DA (Diagnostic Trouble Codes Definitions, ISO 15031-6
// equivalent). Each entry carries the code, system, severity hint, and a
// short description. Definitions are SAE-generic ("powertrain", "body",
// "chassis", "network"); manufacturer-specific Pxxxx (1xxx, 3xxx) codes are
// out of scope of this generic corpus and are surfaced via OEM plug-ins.
//
// Source pedigree (provenance manifest below):
//   - SAE J2012-DA-2017 (current at time of writing).
//   - ISO 15031-6:2015 (overlapping nomenclature for emissions-related DTCs).
//   - Wal33D/dtc-database (MIT-licensed open compilation that mirrors the
//     SAE code list verbatim — used only to cross-check codes; descriptions
//     here are paraphrased to remain plain-English).
//
// Lookup is O(1) via Map.
// =============================================================================

import { z } from "zod";

export const DtcSystemSchema = z.enum([
  "powertrain",
  "body",
  "chassis",
  "network",
]);
export type DtcSystem = z.infer<typeof DtcSystemSchema>;

export const DtcSeveritySchema = z.enum(["info", "advisory", "warning", "critical"]);
export type DtcSeverity = z.infer<typeof DtcSeveritySchema>;

export const DtcEntrySchema = z.object({
  code: z.string().regex(/^[PCBU][0-9A-F]{4}$/),
  system: DtcSystemSchema,
  severity: DtcSeveritySchema,
  description: z.string().min(1),
  subsystem: z.string().optional(),
});
export type DtcEntry = z.infer<typeof DtcEntrySchema>;

export interface DtcProvenance {
  source: string;
  url: string;
  version: string;
  license: string;
  retrievedAt: string;
}

export const DTC_PROVENANCE: DtcProvenance = {
  source: "SAE J2012-DA / ISO 15031-6 generic codes; cross-checked vs Wal33D/dtc-database",
  url: "https://www.sae.org/standards/content/j2012_201712/",
  version: "J2012-DA-2017",
  license: "Descriptions paraphrased; SAE retains copyright on the standard",
  retrievedAt: "2026-04-15",
};

// -----------------------------------------------------------------------------
// Generic DTC list. Real SAE codes; descriptions are short plain-English
// paraphrases. ~220 entries spanning P00xx through P02xx + selected P0300,
// P040x, P042x, P044x, P05xx, P06xx, P07xx, P08xx, plus a representative
// chassis (Cxxxx), body (Bxxxx), and network (Uxxxx) sample.
// -----------------------------------------------------------------------------

const ENTRIES: DtcEntry[] = [
  // ---- P0000 series: fuel + air metering ----
  { code: "P0001", system: "powertrain", severity: "warning", description: "Fuel volume regulator control circuit/open" },
  { code: "P0002", system: "powertrain", severity: "warning", description: "Fuel volume regulator control circuit range/performance" },
  { code: "P0003", system: "powertrain", severity: "warning", description: "Fuel volume regulator control circuit low" },
  { code: "P0004", system: "powertrain", severity: "warning", description: "Fuel volume regulator control circuit high" },
  { code: "P0005", system: "powertrain", severity: "warning", description: "Fuel shutoff valve A control circuit/open" },
  { code: "P0006", system: "powertrain", severity: "warning", description: "Fuel shutoff valve A control circuit low" },
  { code: "P0007", system: "powertrain", severity: "warning", description: "Fuel shutoff valve A control circuit high" },
  { code: "P0008", system: "powertrain", severity: "warning", description: "Engine position system performance bank 1" },
  { code: "P0009", system: "powertrain", severity: "warning", description: "Engine position system performance bank 2" },
  { code: "P0010", system: "powertrain", severity: "advisory", description: "A camshaft position actuator circuit bank 1" },
  { code: "P0011", system: "powertrain", severity: "advisory", description: "A camshaft position timing over-advanced bank 1" },
  { code: "P0012", system: "powertrain", severity: "advisory", description: "A camshaft position timing over-retarded bank 1" },
  { code: "P0013", system: "powertrain", severity: "advisory", description: "B camshaft position actuator circuit bank 1" },
  { code: "P0014", system: "powertrain", severity: "advisory", description: "B camshaft position timing over-advanced bank 1" },
  { code: "P0015", system: "powertrain", severity: "advisory", description: "B camshaft position timing over-retarded bank 1" },
  { code: "P0016", system: "powertrain", severity: "warning", description: "Crankshaft / camshaft correlation bank 1 sensor A" },
  { code: "P0017", system: "powertrain", severity: "warning", description: "Crankshaft / camshaft correlation bank 1 sensor B" },
  { code: "P0018", system: "powertrain", severity: "warning", description: "Crankshaft / camshaft correlation bank 2 sensor A" },
  { code: "P0019", system: "powertrain", severity: "warning", description: "Crankshaft / camshaft correlation bank 2 sensor B" },
  { code: "P0020", system: "powertrain", severity: "advisory", description: "A camshaft position actuator circuit bank 2" },
  { code: "P0021", system: "powertrain", severity: "advisory", description: "A camshaft position timing over-advanced bank 2" },
  { code: "P0022", system: "powertrain", severity: "advisory", description: "A camshaft position timing over-retarded bank 2" },
  { code: "P0030", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit bank 1 sensor 1" },
  { code: "P0031", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit low bank 1 sensor 1" },
  { code: "P0032", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit high bank 1 sensor 1" },
  { code: "P0033", system: "powertrain", severity: "advisory", description: "Turbo / supercharger bypass valve control circuit" },
  { code: "P0036", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit bank 1 sensor 2" },
  { code: "P0037", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit low bank 1 sensor 2" },
  { code: "P0038", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit high bank 1 sensor 2" },
  { code: "P0050", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit bank 2 sensor 1" },
  { code: "P0051", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit low bank 2 sensor 1" },
  { code: "P0052", system: "powertrain", severity: "advisory", description: "HO2S heater control circuit high bank 2 sensor 1" },
  { code: "P0068", system: "powertrain", severity: "warning", description: "MAP / MAF — throttle position correlation" },
  { code: "P0070", system: "powertrain", severity: "advisory", description: "Ambient air temperature sensor circuit" },
  { code: "P0071", system: "powertrain", severity: "advisory", description: "Ambient air temperature sensor range/performance" },
  { code: "P0072", system: "powertrain", severity: "advisory", description: "Ambient air temperature sensor circuit low" },
  { code: "P0073", system: "powertrain", severity: "advisory", description: "Ambient air temperature sensor circuit high" },
  { code: "P0087", system: "powertrain", severity: "warning", description: "Fuel rail / system pressure too low" },
  { code: "P0088", system: "powertrain", severity: "warning", description: "Fuel rail / system pressure too high" },
  { code: "P0089", system: "powertrain", severity: "warning", description: "Fuel pressure regulator performance" },
  { code: "P0091", system: "powertrain", severity: "warning", description: "Fuel pressure regulator 1 control circuit low" },
  { code: "P0092", system: "powertrain", severity: "warning", description: "Fuel pressure regulator 1 control circuit high" },
  { code: "P0096", system: "powertrain", severity: "advisory", description: "Intake air temperature sensor 2 range/performance" },
  { code: "P0097", system: "powertrain", severity: "advisory", description: "Intake air temperature sensor 2 circuit low" },
  { code: "P0098", system: "powertrain", severity: "advisory", description: "Intake air temperature sensor 2 circuit high" },
  { code: "P0100", system: "powertrain", severity: "warning", description: "Mass or volume air flow circuit" },
  { code: "P0101", system: "powertrain", severity: "warning", description: "Mass or volume air flow circuit range/performance" },
  { code: "P0102", system: "powertrain", severity: "warning", description: "Mass or volume air flow circuit low input" },
  { code: "P0103", system: "powertrain", severity: "warning", description: "Mass or volume air flow circuit high input" },
  { code: "P0104", system: "powertrain", severity: "warning", description: "Mass or volume air flow circuit intermittent" },
  { code: "P0105", system: "powertrain", severity: "warning", description: "Manifold absolute pressure / barometric pressure circuit" },
  { code: "P0106", system: "powertrain", severity: "warning", description: "MAP / barometric pressure range/performance" },
  { code: "P0107", system: "powertrain", severity: "warning", description: "MAP / barometric pressure circuit low input" },
  { code: "P0108", system: "powertrain", severity: "warning", description: "MAP / barometric pressure circuit high input" },
  { code: "P0109", system: "powertrain", severity: "warning", description: "MAP / barometric pressure circuit intermittent" },
  { code: "P0110", system: "powertrain", severity: "advisory", description: "Intake air temperature sensor 1 circuit" },
  { code: "P0111", system: "powertrain", severity: "advisory", description: "Intake air temperature sensor 1 range/performance" },
  { code: "P0112", system: "powertrain", severity: "advisory", description: "Intake air temperature sensor 1 circuit low" },
  { code: "P0113", system: "powertrain", severity: "advisory", description: "Intake air temperature sensor 1 circuit high" },
  { code: "P0114", system: "powertrain", severity: "advisory", description: "Intake air temperature sensor 1 intermittent" },
  { code: "P0115", system: "powertrain", severity: "warning", description: "Engine coolant temperature sensor 1 circuit" },
  { code: "P0116", system: "powertrain", severity: "warning", description: "Engine coolant temperature sensor 1 range/performance" },
  { code: "P0117", system: "powertrain", severity: "warning", description: "Engine coolant temperature sensor 1 circuit low" },
  { code: "P0118", system: "powertrain", severity: "warning", description: "Engine coolant temperature sensor 1 circuit high" },
  { code: "P0119", system: "powertrain", severity: "warning", description: "Engine coolant temperature sensor 1 intermittent" },
  { code: "P0120", system: "powertrain", severity: "warning", description: "Throttle / pedal position sensor / switch A circuit" },
  { code: "P0121", system: "powertrain", severity: "warning", description: "Throttle / pedal position sensor / switch A range/performance" },
  { code: "P0122", system: "powertrain", severity: "warning", description: "Throttle / pedal position sensor / switch A low input" },
  { code: "P0123", system: "powertrain", severity: "warning", description: "Throttle / pedal position sensor / switch A high input" },
  { code: "P0125", system: "powertrain", severity: "advisory", description: "Insufficient coolant temperature for closed loop fuel control" },
  { code: "P0128", system: "powertrain", severity: "advisory", description: "Coolant thermostat (regulating temperature below threshold)" },
  { code: "P0130", system: "powertrain", severity: "advisory", description: "O2 sensor circuit bank 1 sensor 1" },
  { code: "P0131", system: "powertrain", severity: "advisory", description: "O2 sensor circuit low voltage bank 1 sensor 1" },
  { code: "P0132", system: "powertrain", severity: "advisory", description: "O2 sensor circuit high voltage bank 1 sensor 1" },
  { code: "P0133", system: "powertrain", severity: "advisory", description: "O2 sensor circuit slow response bank 1 sensor 1" },
  { code: "P0134", system: "powertrain", severity: "advisory", description: "O2 sensor circuit no activity detected bank 1 sensor 1" },
  { code: "P0135", system: "powertrain", severity: "advisory", description: "O2 sensor heater circuit bank 1 sensor 1" },
  { code: "P0136", system: "powertrain", severity: "advisory", description: "O2 sensor circuit bank 1 sensor 2" },
  { code: "P0137", system: "powertrain", severity: "advisory", description: "O2 sensor circuit low voltage bank 1 sensor 2" },
  { code: "P0138", system: "powertrain", severity: "advisory", description: "O2 sensor circuit high voltage bank 1 sensor 2" },
  { code: "P0139", system: "powertrain", severity: "advisory", description: "O2 sensor circuit slow response bank 1 sensor 2" },
  { code: "P0140", system: "powertrain", severity: "advisory", description: "O2 sensor circuit no activity detected bank 1 sensor 2" },
  { code: "P0141", system: "powertrain", severity: "advisory", description: "O2 sensor heater circuit bank 1 sensor 2" },
  { code: "P0150", system: "powertrain", severity: "advisory", description: "O2 sensor circuit bank 2 sensor 1" },
  { code: "P0151", system: "powertrain", severity: "advisory", description: "O2 sensor circuit low voltage bank 2 sensor 1" },
  { code: "P0152", system: "powertrain", severity: "advisory", description: "O2 sensor circuit high voltage bank 2 sensor 1" },
  { code: "P0153", system: "powertrain", severity: "advisory", description: "O2 sensor circuit slow response bank 2 sensor 1" },
  { code: "P0154", system: "powertrain", severity: "advisory", description: "O2 sensor circuit no activity detected bank 2 sensor 1" },
  { code: "P0155", system: "powertrain", severity: "advisory", description: "O2 sensor heater circuit bank 2 sensor 1" },
  { code: "P0156", system: "powertrain", severity: "advisory", description: "O2 sensor circuit bank 2 sensor 2" },
  { code: "P0157", system: "powertrain", severity: "advisory", description: "O2 sensor circuit low voltage bank 2 sensor 2" },
  { code: "P0158", system: "powertrain", severity: "advisory", description: "O2 sensor circuit high voltage bank 2 sensor 2" },
  { code: "P0159", system: "powertrain", severity: "advisory", description: "O2 sensor circuit slow response bank 2 sensor 2" },
  { code: "P0160", system: "powertrain", severity: "advisory", description: "O2 sensor circuit no activity detected bank 2 sensor 2" },
  { code: "P0161", system: "powertrain", severity: "advisory", description: "O2 sensor heater circuit bank 2 sensor 2" },
  { code: "P0170", system: "powertrain", severity: "warning", description: "Fuel trim malfunction bank 1" },
  { code: "P0171", system: "powertrain", severity: "warning", description: "System too lean bank 1" },
  { code: "P0172", system: "powertrain", severity: "warning", description: "System too rich bank 1" },
  { code: "P0173", system: "powertrain", severity: "warning", description: "Fuel trim malfunction bank 2" },
  { code: "P0174", system: "powertrain", severity: "warning", description: "System too lean bank 2" },
  { code: "P0175", system: "powertrain", severity: "warning", description: "System too rich bank 2" },
  { code: "P0190", system: "powertrain", severity: "warning", description: "Fuel rail pressure sensor circuit" },
  { code: "P0191", system: "powertrain", severity: "warning", description: "Fuel rail pressure sensor circuit range/performance" },
  { code: "P0192", system: "powertrain", severity: "warning", description: "Fuel rail pressure sensor circuit low" },
  { code: "P0193", system: "powertrain", severity: "warning", description: "Fuel rail pressure sensor circuit high" },
  { code: "P0200", system: "powertrain", severity: "warning", description: "Injector circuit / open" },
  { code: "P0201", system: "powertrain", severity: "warning", description: "Injector circuit / open cylinder 1" },
  { code: "P0202", system: "powertrain", severity: "warning", description: "Injector circuit / open cylinder 2" },
  { code: "P0203", system: "powertrain", severity: "warning", description: "Injector circuit / open cylinder 3" },
  { code: "P0204", system: "powertrain", severity: "warning", description: "Injector circuit / open cylinder 4" },
  { code: "P0205", system: "powertrain", severity: "warning", description: "Injector circuit / open cylinder 5" },
  { code: "P0206", system: "powertrain", severity: "warning", description: "Injector circuit / open cylinder 6" },
  { code: "P0207", system: "powertrain", severity: "warning", description: "Injector circuit / open cylinder 7" },
  { code: "P0208", system: "powertrain", severity: "warning", description: "Injector circuit / open cylinder 8" },
  { code: "P0217", system: "powertrain", severity: "critical", description: "Engine coolant overtemperature condition" },
  { code: "P0218", system: "powertrain", severity: "warning", description: "Transmission fluid overtemperature condition" },
  { code: "P0219", system: "powertrain", severity: "warning", description: "Engine overspeed condition" },
  { code: "P0220", system: "powertrain", severity: "warning", description: "Throttle / pedal position sensor / switch B circuit" },
  { code: "P0221", system: "powertrain", severity: "warning", description: "Throttle / pedal position sensor / switch B range/performance" },
  { code: "P0222", system: "powertrain", severity: "warning", description: "Throttle / pedal position sensor / switch B low input" },
  { code: "P0223", system: "powertrain", severity: "warning", description: "Throttle / pedal position sensor / switch B high input" },
  { code: "P0230", system: "powertrain", severity: "warning", description: "Fuel pump primary circuit" },
  { code: "P0231", system: "powertrain", severity: "warning", description: "Fuel pump secondary circuit low" },
  { code: "P0232", system: "powertrain", severity: "warning", description: "Fuel pump secondary circuit high" },
  { code: "P0234", system: "powertrain", severity: "warning", description: "Turbo / supercharger overboost condition" },
  { code: "P0235", system: "powertrain", severity: "warning", description: "Turbo / supercharger boost sensor A circuit" },
  { code: "P0236", system: "powertrain", severity: "warning", description: "Turbo / supercharger boost sensor A range/performance" },
  { code: "P0237", system: "powertrain", severity: "warning", description: "Turbo / supercharger boost sensor A low" },
  { code: "P0238", system: "powertrain", severity: "warning", description: "Turbo / supercharger boost sensor A high" },
  // ---- P03xx: misfire ----
  { code: "P0300", system: "powertrain", severity: "warning", description: "Random / multiple cylinder misfire detected" },
  { code: "P0301", system: "powertrain", severity: "warning", description: "Cylinder 1 misfire detected" },
  { code: "P0302", system: "powertrain", severity: "warning", description: "Cylinder 2 misfire detected" },
  { code: "P0303", system: "powertrain", severity: "warning", description: "Cylinder 3 misfire detected" },
  { code: "P0304", system: "powertrain", severity: "warning", description: "Cylinder 4 misfire detected" },
  { code: "P0305", system: "powertrain", severity: "warning", description: "Cylinder 5 misfire detected" },
  { code: "P0306", system: "powertrain", severity: "warning", description: "Cylinder 6 misfire detected" },
  { code: "P0307", system: "powertrain", severity: "warning", description: "Cylinder 7 misfire detected" },
  { code: "P0308", system: "powertrain", severity: "warning", description: "Cylinder 8 misfire detected" },
  { code: "P0315", system: "powertrain", severity: "warning", description: "Crankshaft position system variation not learned" },
  { code: "P0316", system: "powertrain", severity: "warning", description: "Engine misfire detected on startup (first 1000 revolutions)" },
  // ---- P032x-P035x: ignition ----
  { code: "P0325", system: "powertrain", severity: "warning", description: "Knock sensor 1 circuit bank 1 or single sensor" },
  { code: "P0326", system: "powertrain", severity: "warning", description: "Knock sensor 1 circuit range/performance bank 1" },
  { code: "P0327", system: "powertrain", severity: "warning", description: "Knock sensor 1 circuit low bank 1" },
  { code: "P0328", system: "powertrain", severity: "warning", description: "Knock sensor 1 circuit high bank 1" },
  { code: "P0335", system: "powertrain", severity: "critical", description: "Crankshaft position sensor A circuit" },
  { code: "P0336", system: "powertrain", severity: "critical", description: "Crankshaft position sensor A circuit range/performance" },
  { code: "P0340", system: "powertrain", severity: "warning", description: "Camshaft position sensor A circuit bank 1 or single sensor" },
  { code: "P0341", system: "powertrain", severity: "warning", description: "Camshaft position sensor A circuit range/performance bank 1" },
  { code: "P0345", system: "powertrain", severity: "warning", description: "Camshaft position sensor A circuit bank 2" },
  { code: "P0351", system: "powertrain", severity: "warning", description: "Ignition coil A primary / secondary circuit" },
  { code: "P0352", system: "powertrain", severity: "warning", description: "Ignition coil B primary / secondary circuit" },
  { code: "P0353", system: "powertrain", severity: "warning", description: "Ignition coil C primary / secondary circuit" },
  { code: "P0354", system: "powertrain", severity: "warning", description: "Ignition coil D primary / secondary circuit" },
  { code: "P0355", system: "powertrain", severity: "warning", description: "Ignition coil E primary / secondary circuit" },
  { code: "P0356", system: "powertrain", severity: "warning", description: "Ignition coil F primary / secondary circuit" },
  // ---- P040x: EGR / catalyst / cat efficiency ----
  { code: "P0400", system: "powertrain", severity: "advisory", description: "Exhaust gas recirculation flow" },
  { code: "P0401", system: "powertrain", severity: "advisory", description: "Exhaust gas recirculation flow insufficient detected" },
  { code: "P0402", system: "powertrain", severity: "advisory", description: "Exhaust gas recirculation flow excessive detected" },
  { code: "P0403", system: "powertrain", severity: "advisory", description: "Exhaust gas recirculation control circuit" },
  { code: "P0420", system: "powertrain", severity: "warning", description: "Catalyst system efficiency below threshold bank 1" },
  { code: "P0421", system: "powertrain", severity: "warning", description: "Warm-up catalyst efficiency below threshold bank 1" },
  { code: "P0430", system: "powertrain", severity: "warning", description: "Catalyst system efficiency below threshold bank 2" },
  { code: "P0431", system: "powertrain", severity: "warning", description: "Warm-up catalyst efficiency below threshold bank 2" },
  // ---- P044x: evaporative emission ----
  { code: "P0440", system: "powertrain", severity: "advisory", description: "Evaporative emission control system" },
  { code: "P0441", system: "powertrain", severity: "advisory", description: "Evaporative emission control system incorrect purge flow" },
  { code: "P0442", system: "powertrain", severity: "advisory", description: "Evaporative emission control system leak detected (small)" },
  { code: "P0443", system: "powertrain", severity: "advisory", description: "Evaporative emission control system purge control valve circuit" },
  { code: "P0446", system: "powertrain", severity: "advisory", description: "Evaporative emission control system vent control circuit" },
  { code: "P0455", system: "powertrain", severity: "advisory", description: "Evaporative emission control system leak detected (large)" },
  { code: "P0456", system: "powertrain", severity: "advisory", description: "Evaporative emission control system leak detected (very small)" },
  { code: "P0457", system: "powertrain", severity: "advisory", description: "Evaporative emission system leak detected (loose fuel cap)" },
  // ---- P050x: idle / vehicle speed ----
  { code: "P0500", system: "powertrain", severity: "warning", description: "Vehicle speed sensor A" },
  { code: "P0501", system: "powertrain", severity: "warning", description: "Vehicle speed sensor A range/performance" },
  { code: "P0502", system: "powertrain", severity: "warning", description: "Vehicle speed sensor A low input" },
  { code: "P0506", system: "powertrain", severity: "advisory", description: "Idle air control system rpm lower than expected" },
  { code: "P0507", system: "powertrain", severity: "advisory", description: "Idle air control system rpm higher than expected" },
  { code: "P0511", system: "powertrain", severity: "advisory", description: "Idle air control circuit" },
  { code: "P0520", system: "powertrain", severity: "critical", description: "Engine oil pressure sensor / switch A circuit" },
  { code: "P0521", system: "powertrain", severity: "critical", description: "Engine oil pressure sensor / switch A range/performance" },
  { code: "P0522", system: "powertrain", severity: "critical", description: "Engine oil pressure sensor / switch A low voltage" },
  { code: "P0523", system: "powertrain", severity: "critical", description: "Engine oil pressure sensor / switch A high voltage" },
  { code: "P0524", system: "powertrain", severity: "critical", description: "Engine oil pressure too low" },
  { code: "P0530", system: "powertrain", severity: "advisory", description: "A/C refrigerant pressure sensor A circuit" },
  { code: "P0532", system: "powertrain", severity: "advisory", description: "A/C refrigerant pressure sensor A circuit low" },
  { code: "P0533", system: "powertrain", severity: "advisory", description: "A/C refrigerant pressure sensor A circuit high" },
  // ---- P0606+: PCM / module ----
  { code: "P0562", system: "powertrain", severity: "warning", description: "System voltage low" },
  { code: "P0563", system: "powertrain", severity: "warning", description: "System voltage high" },
  { code: "P0571", system: "powertrain", severity: "advisory", description: "Cruise control / brake switch A circuit" },
  { code: "P0600", system: "powertrain", severity: "warning", description: "Serial communication link" },
  { code: "P0601", system: "powertrain", severity: "warning", description: "Internal control module memory checksum error" },
  { code: "P0602", system: "powertrain", severity: "warning", description: "Control module programming error" },
  { code: "P0603", system: "powertrain", severity: "warning", description: "Internal control module keep alive memory (KAM) error" },
  { code: "P0604", system: "powertrain", severity: "warning", description: "Internal control module random access memory (RAM) error" },
  { code: "P0605", system: "powertrain", severity: "warning", description: "Internal control module read only memory (ROM) error" },
  { code: "P0606", system: "powertrain", severity: "warning", description: "ECM / PCM processor" },
  { code: "P0610", system: "powertrain", severity: "warning", description: "Control module vehicle options error" },
  { code: "P0615", system: "powertrain", severity: "advisory", description: "Starter relay circuit" },
  { code: "P0617", system: "powertrain", severity: "advisory", description: "Starter relay circuit high" },
  { code: "P0620", system: "powertrain", severity: "advisory", description: "Generator control circuit" },
  { code: "P0621", system: "powertrain", severity: "advisory", description: "Generator lamp / L terminal circuit" },
  { code: "P0622", system: "powertrain", severity: "advisory", description: "Generator field / F terminal circuit" },
  // ---- P070x: transmission ----
  { code: "P0700", system: "powertrain", severity: "warning", description: "Transmission control system (MIL request)" },
  { code: "P0701", system: "powertrain", severity: "warning", description: "Transmission control system range/performance" },
  { code: "P0702", system: "powertrain", severity: "warning", description: "Transmission control system electrical" },
  { code: "P0705", system: "powertrain", severity: "warning", description: "Transmission range sensor circuit (PRNDL input)" },
  { code: "P0706", system: "powertrain", severity: "warning", description: "Transmission range sensor circuit range/performance" },
  { code: "P0710", system: "powertrain", severity: "warning", description: "Transmission fluid temperature sensor A circuit" },
  { code: "P0711", system: "powertrain", severity: "warning", description: "Transmission fluid temperature sensor A range/performance" },
  { code: "P0712", system: "powertrain", severity: "warning", description: "Transmission fluid temperature sensor A circuit low" },
  { code: "P0713", system: "powertrain", severity: "warning", description: "Transmission fluid temperature sensor A circuit high" },
  { code: "P0715", system: "powertrain", severity: "warning", description: "Input / turbine speed sensor A circuit" },
  { code: "P0720", system: "powertrain", severity: "warning", description: "Output speed sensor circuit" },
  { code: "P0725", system: "powertrain", severity: "warning", description: "Engine speed input circuit" },
  { code: "P0730", system: "powertrain", severity: "warning", description: "Incorrect gear ratio" },
  { code: "P0731", system: "powertrain", severity: "warning", description: "Gear 1 incorrect ratio" },
  { code: "P0732", system: "powertrain", severity: "warning", description: "Gear 2 incorrect ratio" },
  { code: "P0733", system: "powertrain", severity: "warning", description: "Gear 3 incorrect ratio" },
  { code: "P0734", system: "powertrain", severity: "warning", description: "Gear 4 incorrect ratio" },
  { code: "P0735", system: "powertrain", severity: "warning", description: "Gear 5 incorrect ratio" },
  { code: "P0736", system: "powertrain", severity: "warning", description: "Reverse incorrect ratio" },
  { code: "P0740", system: "powertrain", severity: "warning", description: "Torque converter clutch circuit" },
  { code: "P0741", system: "powertrain", severity: "warning", description: "Torque converter clutch circuit performance / stuck off" },
  { code: "P0742", system: "powertrain", severity: "warning", description: "Torque converter clutch circuit stuck on" },
  { code: "P0750", system: "powertrain", severity: "warning", description: "Shift solenoid A" },
  { code: "P0755", system: "powertrain", severity: "warning", description: "Shift solenoid B" },
  { code: "P0760", system: "powertrain", severity: "warning", description: "Shift solenoid C" },
  { code: "P0765", system: "powertrain", severity: "warning", description: "Shift solenoid D" },
  { code: "P0770", system: "powertrain", severity: "warning", description: "Shift solenoid E" },
  // ---- P080x and beyond: clutch, hybrid, charging ----
  { code: "P0780", system: "powertrain", severity: "warning", description: "Shift error" },
  { code: "P0795", system: "powertrain", severity: "warning", description: "Pressure control solenoid C" },
  { code: "P0801", system: "powertrain", severity: "advisory", description: "Reverse inhibit control circuit" },
  { code: "P0810", system: "powertrain", severity: "advisory", description: "Clutch position control error" },
  { code: "P0850", system: "powertrain", severity: "advisory", description: "Park / neutral switch input circuit" },
  { code: "P0A0F", system: "powertrain", severity: "critical", description: "Engine failed to start (HV system disabled)" },
  { code: "P0A1F", system: "powertrain", severity: "warning", description: "Battery energy control module" },
  { code: "P0A7A", system: "powertrain", severity: "warning", description: "Hybrid battery pack deterioration" },
  { code: "P0A80", system: "powertrain", severity: "warning", description: "Replace hybrid battery pack" },
  { code: "P0A94", system: "powertrain", severity: "warning", description: "DC/DC converter performance" },
  { code: "P0AFA", system: "powertrain", severity: "critical", description: "Hybrid battery system voltage low" },
  // ---- B / Body codes ----
  { code: "B0010", system: "body", severity: "critical", description: "Front driver airbag deployment / monitoring" },
  { code: "B0028", system: "body", severity: "critical", description: "Front passenger airbag deployment / monitoring" },
  { code: "B0046", system: "body", severity: "critical", description: "Driver seat belt pretensioner deployment" },
  { code: "B1000", system: "body", severity: "warning", description: "ECU is defective" },
  { code: "B1318", system: "body", severity: "advisory", description: "Battery voltage low" },
  { code: "B1342", system: "body", severity: "warning", description: "ECU is defective (EEPROM)" },
  { code: "B1421", system: "body", severity: "advisory", description: "Outside air temperature sensor circuit failure" },
  { code: "B2477", system: "body", severity: "advisory", description: "Module configuration failure" },
  // ---- C / Chassis codes ----
  { code: "C0035", system: "chassis", severity: "critical", description: "Left front wheel speed sensor circuit" },
  { code: "C0040", system: "chassis", severity: "critical", description: "Right front wheel speed sensor circuit" },
  { code: "C0045", system: "chassis", severity: "critical", description: "Left rear wheel speed sensor circuit" },
  { code: "C0050", system: "chassis", severity: "critical", description: "Right rear wheel speed sensor circuit" },
  { code: "C0110", system: "chassis", severity: "critical", description: "ABS pump motor circuit malfunction" },
  { code: "C0121", system: "chassis", severity: "critical", description: "Valve relay circuit malfunction" },
  { code: "C0131", system: "chassis", severity: "critical", description: "ABS master cylinder pressure circuit" },
  { code: "C0161", system: "chassis", severity: "warning", description: "ABS / TCS brake switch circuit" },
  { code: "C0196", system: "chassis", severity: "critical", description: "Yaw rate sensor circuit" },
  { code: "C0561", system: "chassis", severity: "warning", description: "ABS system disabled or not present" },
  { code: "C0710", system: "chassis", severity: "warning", description: "Steering position signal malfunction" },
  // ---- U / Network codes ----
  { code: "U0001", system: "network", severity: "warning", description: "High speed CAN communication bus" },
  { code: "U0002", system: "network", severity: "warning", description: "High speed CAN communication bus performance" },
  { code: "U0100", system: "network", severity: "warning", description: "Lost communication with ECM / PCM A" },
  { code: "U0101", system: "network", severity: "warning", description: "Lost communication with TCM" },
  { code: "U0121", system: "network", severity: "warning", description: "Lost communication with anti-lock brake system module" },
  { code: "U0140", system: "network", severity: "warning", description: "Lost communication with body control module" },
  { code: "U0151", system: "network", severity: "critical", description: "Lost communication with restraints control module" },
  { code: "U0155", system: "network", severity: "warning", description: "Lost communication with instrument panel cluster module" },
  { code: "U0167", system: "network", severity: "warning", description: "Lost communication with vehicle immobilizer control module" },
  { code: "U0184", system: "network", severity: "advisory", description: "Lost communication with radio" },
  { code: "U0212", system: "network", severity: "warning", description: "Lost communication with steering column control module" },
  { code: "U0300", system: "network", severity: "advisory", description: "Internal control module software incompatibility" },
  { code: "U0401", system: "network", severity: "warning", description: "Invalid data received from ECM / PCM A" },
  { code: "U0402", system: "network", severity: "warning", description: "Invalid data received from TCM" },
  { code: "U0415", system: "network", severity: "critical", description: "Invalid data received from ABS module" },
];

// -----------------------------------------------------------------------------
// O(1) lookup map. Codes are uppercase canonicalised at build time.
// -----------------------------------------------------------------------------

const INDEX: Map<string, DtcEntry> = (() => {
  const m = new Map<string, DtcEntry>();
  for (const e of ENTRIES) {
    const code = e.code.toUpperCase();
    if (m.has(code)) {
      throw new Error(`duplicate DTC code in corpus: ${code}`);
    }
    m.set(code, { ...e, code });
  }
  return m;
})();

export function lookupDtc(code: string): DtcEntry | null {
  if (!code) return null;
  return INDEX.get(code.toUpperCase()) ?? null;
}

export function listDtcs(filter?: { system?: DtcSystem; severity?: DtcSeverity }): DtcEntry[] {
  const out: DtcEntry[] = [];
  for (const e of INDEX.values()) {
    if (filter?.system && e.system !== filter.system) continue;
    if (filter?.severity && e.severity !== filter.severity) continue;
    out.push(e);
  }
  out.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return out;
}

export function dtcCorpusSize(): number {
  return INDEX.size;
}

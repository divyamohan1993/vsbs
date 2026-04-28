// =============================================================================
// ISO 2575:2010/2021 — Road vehicles — Symbols for controls, indicators and
// tell-tales. The standard catalogues the colour-coded indicator icons that
// every passenger-vehicle dash uses. ISO 2575 is referenced in UNECE R121
// for the mandatory subset.
//
// Colour-coding (ISO 2575:2010 Table 1):
//   red    — danger, requires immediate stop (severity 3)
//   amber  — warning, attention required soon (severity 2)
//   green  — system active, advisory (severity 1)
//   blue   — high beam (advisory, severity 1)
//   white  — system status (severity 1)
//
// We pin the canonical name as `ICON_<CONCEPT>` so both ECU diagnostic
// streams and OEM webhook payloads can use the same identifier on the wire.
// O(1) lookup via Map.
// =============================================================================

import { z } from "zod";

export const TellTaleColorSchema = z.enum(["red", "amber", "green", "blue", "white"]);
export type TellTaleColor = z.infer<typeof TellTaleColorSchema>;

export const TellTaleSeveritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type TellTaleSeverity = z.infer<typeof TellTaleSeveritySchema>;

export const TellTaleCategorySchema = z.enum(["warning", "indicator", "info"]);
export type TellTaleCategory = z.infer<typeof TellTaleCategorySchema>;

export const TellTaleSchema = z.object({
  id: z.string().regex(/^ICON_[A-Z][A-Z0-9_]*$/),
  name: z.string().min(1),
  color: TellTaleColorSchema,
  severity: TellTaleSeveritySchema,
  category: TellTaleCategorySchema,
  description: z.string().min(1),
  isoReference: z.string().min(1),
});
export type TellTale = z.infer<typeof TellTaleSchema>;

const ENTRIES: TellTale[] = [
  // ---- Red (severity 3): immediate-action group ----
  {
    id: "ICON_OIL_PRESSURE_LOW",
    name: "Engine oil pressure low",
    color: "red",
    severity: 3,
    category: "warning",
    description: "Insufficient engine oil pressure. Stop the engine as soon as it is safe to prevent bearing damage.",
    isoReference: "ISO 2575:2010 §H.2 #ISO 7000-0248",
  },
  {
    id: "ICON_BATTERY_CHARGE",
    name: "Battery charge fault",
    color: "red",
    severity: 3,
    category: "warning",
    description: "Charging system not delivering current. The vehicle is running on battery only and will stall once depleted.",
    isoReference: "ISO 2575:2010 §H.7 #ISO 7000-0247",
  },
  {
    id: "ICON_BRAKE_SYSTEM",
    name: "Brake system warning",
    color: "red",
    severity: 3,
    category: "warning",
    description: "Critical brake-system condition: parking brake on, brake fluid low, or hydraulic fault. Stop and inspect.",
    isoReference: "ISO 2575:2010 §H.5 #ISO 7000-0245",
  },
  {
    id: "ICON_AIRBAG",
    name: "Supplemental restraint system",
    color: "red",
    severity: 3,
    category: "warning",
    description: "Airbag/SRS fault. The system may not deploy in a crash. Service immediately.",
    isoReference: "ISO 2575:2010 §H.18",
  },
  {
    id: "ICON_SEATBELT",
    name: "Seat belt unfastened",
    color: "red",
    severity: 3,
    category: "warning",
    description: "Driver or front passenger seat belt is not fastened.",
    isoReference: "ISO 2575:2010 §H.4 #ISO 7000-0249",
  },
  {
    id: "ICON_ENGINE_TEMP_HIGH",
    name: "Engine coolant overtemperature",
    color: "red",
    severity: 3,
    category: "warning",
    description: "Coolant temperature is at or above the safe limit. Stop the engine to prevent damage.",
    isoReference: "ISO 2575:2010 §H.3 #ISO 7000-0246",
  },
  {
    id: "ICON_DOOR_OPEN",
    name: "Door open",
    color: "red",
    severity: 3,
    category: "warning",
    description: "One or more doors are not fully closed.",
    isoReference: "ISO 2575:2010 §H.27",
  },
  {
    id: "ICON_HOOD_OPEN",
    name: "Hood (bonnet) open",
    color: "red",
    severity: 3,
    category: "warning",
    description: "The hood is not fully latched.",
    isoReference: "ISO 2575:2010 §H.28",
  },
  {
    id: "ICON_TRUNK_OPEN",
    name: "Trunk (boot) open",
    color: "red",
    severity: 3,
    category: "warning",
    description: "The trunk lid is not fully closed.",
    isoReference: "ISO 2575:2010 §H.29",
  },
  {
    id: "ICON_EV_BATTERY_CRITICAL",
    name: "Traction battery critical",
    color: "red",
    severity: 3,
    category: "warning",
    description: "High-voltage propulsion battery state of charge is critically low or thermally unsafe.",
    isoReference: "ISO 2575:2021 §H.55",
  },
  // ---- Amber (severity 2): warning group ----
  {
    id: "ICON_CHECK_ENGINE",
    name: "Malfunction indicator lamp",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Powertrain emissions-related fault detected. Read OBD-II DTCs and address soon.",
    isoReference: "ISO 2575:2010 §H.16 #ISO 7000-1701",
  },
  {
    id: "ICON_ABS",
    name: "Anti-lock braking system",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "ABS fault. Conventional braking still functions; ABS will not engage during emergency stops.",
    isoReference: "ISO 2575:2010 §H.6",
  },
  {
    id: "ICON_ESP",
    name: "Electronic stability control",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Stability or traction control fault, or system manually disabled.",
    isoReference: "ISO 2575:2010 §H.10",
  },
  {
    id: "ICON_TPMS",
    name: "Tyre pressure monitoring",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "One or more tyres below the manufacturer's recommended pressure.",
    isoReference: "ISO 2575:2010 §H.34 #ISO 7000-2436",
  },
  {
    id: "ICON_LANE_DEPARTURE",
    name: "Lane keeping assist",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Lane keeping assistant fault, unavailable, or about to exit lane unintentionally.",
    isoReference: "ISO 2575:2021 §H.46",
  },
  {
    id: "ICON_FORWARD_COLLISION",
    name: "Forward collision warning",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Risk of forward collision detected. Brake immediately if traffic is present.",
    isoReference: "ISO 2575:2021 §H.49",
  },
  {
    id: "ICON_PARKING_BRAKE",
    name: "Electric parking brake fault",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Electric parking brake actuator fault. The mechanical lock may not engage.",
    isoReference: "ISO 2575:2010 §H.5",
  },
  {
    id: "ICON_LOW_FUEL",
    name: "Low fuel level",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Fuel level below reserve threshold. Refuel soon.",
    isoReference: "ISO 2575:2010 §H.13 #ISO 7000-0245",
  },
  {
    id: "ICON_DEF_LOW",
    name: "Diesel exhaust fluid low",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Diesel exhaust fluid (AdBlue / DEF) below threshold. Engine power may be limited if not refilled.",
    isoReference: "ISO 2575:2021 §H.42",
  },
  {
    id: "ICON_DPF",
    name: "Diesel particulate filter",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Particulate filter regeneration required or filter is loaded.",
    isoReference: "ISO 2575:2021 §H.43",
  },
  {
    id: "ICON_GLOW_PLUG",
    name: "Diesel preheat (glow plug)",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Wait for the lamp to turn off before cranking. If staying on after start, indicates a glow plug fault.",
    isoReference: "ISO 2575:2010 §H.17",
  },
  {
    id: "ICON_AWD_FAULT",
    name: "All-wheel-drive fault",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "All-wheel-drive system has reduced functionality.",
    isoReference: "ISO 2575:2010 §H.41",
  },
  {
    id: "ICON_POWER_STEERING",
    name: "Power steering fault",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Power assist for steering is reduced or unavailable. Effort to steer will increase.",
    isoReference: "ISO 2575:2010 §H.40",
  },
  {
    id: "ICON_AIR_SUSPENSION",
    name: "Air suspension fault",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Air suspension is not maintaining target ride height.",
    isoReference: "ISO 2575:2010 §H.38",
  },
  {
    id: "ICON_WASHER_FLUID_LOW",
    name: "Washer fluid low",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Windshield washer reservoir is low.",
    isoReference: "ISO 2575:2010 §H.31",
  },
  {
    id: "ICON_SERVICE_DUE",
    name: "Service due",
    color: "amber",
    severity: 2,
    category: "warning",
    description: "Scheduled maintenance interval reached.",
    isoReference: "ISO 2575:2021 §H.32",
  },
  // ---- Green (severity 1): system-active group ----
  {
    id: "ICON_TURN_LEFT",
    name: "Left turn signal",
    color: "green",
    severity: 1,
    category: "indicator",
    description: "Left turn or hazard signal active.",
    isoReference: "ISO 2575:2010 §H.21",
  },
  {
    id: "ICON_TURN_RIGHT",
    name: "Right turn signal",
    color: "green",
    severity: 1,
    category: "indicator",
    description: "Right turn or hazard signal active.",
    isoReference: "ISO 2575:2010 §H.21",
  },
  {
    id: "ICON_HEADLIGHT_LOW",
    name: "Low beam headlights",
    color: "green",
    severity: 1,
    category: "indicator",
    description: "Low beam headlights are on.",
    isoReference: "ISO 2575:2010 §H.19",
  },
  {
    id: "ICON_FOG_LIGHTS_FRONT",
    name: "Front fog lamps",
    color: "green",
    severity: 1,
    category: "indicator",
    description: "Front fog lamps are on.",
    isoReference: "ISO 2575:2010 §H.22",
  },
  {
    id: "ICON_CRUISE_ACTIVE",
    name: "Cruise control active",
    color: "green",
    severity: 1,
    category: "indicator",
    description: "Cruise control or adaptive cruise is engaged.",
    isoReference: "ISO 2575:2021 §H.45",
  },
  {
    id: "ICON_AVP_ACTIVE",
    name: "Automated valet parking active",
    color: "green",
    severity: 1,
    category: "indicator",
    description: "Vehicle is operating under an automated valet parking command grant.",
    isoReference: "ISO 23150:2021 §G.7",
  },
  // ---- Blue (severity 1): high-beam ----
  {
    id: "ICON_HIGH_BEAM",
    name: "High beam headlights",
    color: "blue",
    severity: 1,
    category: "indicator",
    description: "High beam headlights are on.",
    isoReference: "ISO 2575:2010 §H.20",
  },
  // ---- White (severity 1): info / status ----
  {
    id: "ICON_FOG_LIGHTS_REAR",
    name: "Rear fog lamps",
    color: "white",
    severity: 1,
    category: "info",
    description: "Rear fog lamps are on.",
    isoReference: "ISO 2575:2010 §H.23",
  },
  {
    id: "ICON_BLUETOOTH",
    name: "Bluetooth connected",
    color: "white",
    severity: 1,
    category: "info",
    description: "A Bluetooth device is paired and connected.",
    isoReference: "ISO 2575:2021 §H.50",
  },
  {
    id: "ICON_AUTOSTART_STOP",
    name: "Auto start-stop active",
    color: "white",
    severity: 1,
    category: "info",
    description: "Engine auto stop-start system is engaged.",
    isoReference: "ISO 2575:2021 §H.47",
  },
  {
    id: "ICON_ECO_MODE",
    name: "Eco driving mode",
    color: "white",
    severity: 1,
    category: "info",
    description: "Eco-mode powertrain calibration is active.",
    isoReference: "ISO 2575:2021 §H.48",
  },
  {
    id: "ICON_SPORT_MODE",
    name: "Sport driving mode",
    color: "white",
    severity: 1,
    category: "info",
    description: "Sport-mode powertrain calibration is active.",
    isoReference: "ISO 2575:2021 §H.51",
  },
  {
    id: "ICON_REGEN_BRAKING",
    name: "Regenerative braking active",
    color: "white",
    severity: 1,
    category: "info",
    description: "Energy is being recuperated to the high-voltage battery during braking.",
    isoReference: "ISO 2575:2021 §H.56",
  },
  {
    id: "ICON_EV_CHARGING",
    name: "EV charging in progress",
    color: "white",
    severity: 1,
    category: "info",
    description: "High-voltage battery is being charged.",
    isoReference: "ISO 2575:2021 §H.54",
  },
  {
    id: "ICON_KEY_FOB_BATTERY_LOW",
    name: "Key fob battery low",
    color: "white",
    severity: 1,
    category: "info",
    description: "Remote key battery is approaching end of life.",
    isoReference: "ISO 2575:2021 §H.52",
  },
];

// O(1) lookup map.
const INDEX: Map<string, TellTale> = (() => {
  const m = new Map<string, TellTale>();
  for (const e of ENTRIES) {
    if (m.has(e.id)) throw new Error(`duplicate tell-tale id: ${e.id}`);
    m.set(e.id, e);
  }
  return m;
})();

export function lookupTellTale(id: string): TellTale | null {
  if (!id) return null;
  return INDEX.get(id) ?? null;
}

export function tellTalesBySeverity(min: TellTaleSeverity): TellTale[] {
  const out: TellTale[] = [];
  for (const e of INDEX.values()) {
    if (e.severity >= min) out.push(e);
  }
  out.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    return a.id < b.id ? -1 : 1;
  });
  return out;
}

export function listTellTales(filter?: { color?: TellTaleColor; category?: TellTaleCategory }): TellTale[] {
  const out: TellTale[] = [];
  for (const e of INDEX.values()) {
    if (filter?.color && e.color !== filter.color) continue;
    if (filter?.category && e.category !== filter.category) continue;
    out.push(e);
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  return out;
}

export function tellTaleCount(): number {
  return INDEX.size;
}

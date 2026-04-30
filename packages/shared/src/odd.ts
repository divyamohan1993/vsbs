// =============================================================================
// Operational Design Domain (ODD) — schema + universal gate.
//
// Every autonomous decision in VSBS (autonomy mint, autonomous dispatch, AVP
// hand-over, mobile-mechanic dispatch, drive-in eligibility) MUST first pass
// through `requireOdd()`. The ODD declares the bounded operating envelope
// under which a decision is *defensible*. Outside that envelope the decision
// is refused, never silently downgraded.
//
// Standards / references:
//   SAE J3016 §8 (ODD definition).
//   ISO 34503 (ODD taxonomy for automated driving systems).
//   UNECE R157 ALKS Annex 3 (operational conditions).
//   ISO 21448 (SOTIF) — ODD is the foundation of intended-functionality safety.
//   See docs/research/autonomy.md §3 and docs/research/prognostics.md §1.
// =============================================================================

import { z } from "zod";

// -----------------------------------------------------------------------------
// Axes
// -----------------------------------------------------------------------------

/**
 * ISO 3166-1 alpha-2 country code. Two upper-case ASCII letters.
 * Region matters because (a) regulator approvals are jurisdiction-bounded and
 * (b) calibration tables are region-keyed.
 */
export const Iso3166Alpha2Schema = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 must be two uppercase letters");

export const WeatherSchema = z.enum([
  "clear",
  "rain",
  "fog",
  "snow",
  "dust",
  "extreme-heat",
  "extreme-cold",
]);
export type Weather = z.infer<typeof WeatherSchema>;

export const TimeOfDaySchema = z.enum(["day", "dawn-dusk", "night"]);
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

/**
 * Vehicle class for ODD/coverage/calibration. India uses CMVR vehicle classes;
 * we collapse to a portable enum that maps cleanly to AIS-053, EU L/M/N
 * categories, and US FMVSS GVWR brackets. See docs/research/automotive.md §2.
 */
export const VehicleClassSchema = z.enum([
  "passenger-light",
  "suv",
  "lcv",
  "hcv",
  "two-wheeler",
  "three-wheeler",
  "ev-passenger",
]);
export type VehicleClass = z.infer<typeof VehicleClassSchema>;

export const RoadClassSchema = z.enum([
  "urban-low",
  "urban-arterial",
  "highway",
  "rural",
  "off-road",
  "private-property",
]);
export type RoadClass = z.infer<typeof RoadClassSchema>;

// -----------------------------------------------------------------------------
// ODD declaration — what an autonomous policy is qualified for
// -----------------------------------------------------------------------------

/**
 * The declared envelope. A decision producer publishes its ODD; the gate
 * checks an incoming OperationalContext against it. All array fields are
 * **allow-lists** (non-empty) to forbid the silent-superset failure mode.
 *
 * `geofenceId` is an optional reference into the autonomy-registry's
 * GeofenceCatalogue; when set, a separate geofence containment check by the
 * caller must have already passed (this schema does not duplicate that check).
 */
export const OperationalDesignDomainSchema = z.object({
  region: z.array(Iso3166Alpha2Schema).min(1),
  weather: z.array(WeatherSchema).min(1),
  timeOfDay: z.array(TimeOfDaySchema).min(1),
  vehicleClass: z.array(VehicleClassSchema).min(1),
  roadClass: z.array(RoadClassSchema).min(1),
  geofenceId: z.string().min(1).optional(),
  maxSpeedKmh: z.number().nonnegative().max(400),
});
export type OperationalDesignDomain = z.infer<typeof OperationalDesignDomainSchema>;

// -----------------------------------------------------------------------------
// Operational context — what VSBS is observing right now
// -----------------------------------------------------------------------------

/**
 * The runtime context VSBS believes it is operating in. All fields are
 * required so that a missing observation is an explicit caller decision
 * (caller must default-then-pass) instead of a silent any-match.
 *
 * `proposedSpeedKmh` is the maximum speed the candidate plan is expected to
 * reach inside the autonomous segment.
 */
export const OperationalContextSchema = z.object({
  region: Iso3166Alpha2Schema,
  weather: WeatherSchema,
  timeOfDay: TimeOfDaySchema,
  vehicleClass: VehicleClassSchema,
  roadClass: RoadClassSchema,
  proposedSpeedKmh: z.number().nonnegative().max(400),
  geofenceId: z.string().min(1).optional(),
});
export type OperationalContext = z.infer<typeof OperationalContextSchema>;

// -----------------------------------------------------------------------------
// Verdict + gate
// -----------------------------------------------------------------------------

export type OddVerdict =
  | { ok: true }
  | { ok: false; reasons: OddViolationReason[] };

export const ODD_VIOLATION_CODES = [
  "region-out-of-envelope",
  "weather-out-of-envelope",
  "time-of-day-out-of-envelope",
  "vehicle-class-out-of-envelope",
  "road-class-out-of-envelope",
  "speed-exceeds-envelope",
  "geofence-mismatch",
] as const;
export type OddViolationCode = (typeof ODD_VIOLATION_CODES)[number];

export interface OddViolationReason {
  code: OddViolationCode;
  message: string;
}

/**
 * Pure, total, O(1) — no I/O, no allocation beyond the reasons array.
 * Aggregates ALL violations rather than short-circuiting so the caller gets
 * the full picture in one pass.
 */
export function oddSatisfied(
  odd: OperationalDesignDomain,
  ctx: OperationalContext,
): OddVerdict {
  const reasons: OddViolationReason[] = [];

  if (!odd.region.includes(ctx.region)) {
    reasons.push({
      code: "region-out-of-envelope",
      message: `Region ${ctx.region} is not in declared ODD regions [${odd.region.join(", ")}].`,
    });
  }
  if (!odd.weather.includes(ctx.weather)) {
    reasons.push({
      code: "weather-out-of-envelope",
      message: `Weather ${ctx.weather} is not in declared ODD weather [${odd.weather.join(", ")}].`,
    });
  }
  if (!odd.timeOfDay.includes(ctx.timeOfDay)) {
    reasons.push({
      code: "time-of-day-out-of-envelope",
      message: `Time-of-day ${ctx.timeOfDay} is not in declared ODD times [${odd.timeOfDay.join(", ")}].`,
    });
  }
  if (!odd.vehicleClass.includes(ctx.vehicleClass)) {
    reasons.push({
      code: "vehicle-class-out-of-envelope",
      message: `Vehicle class ${ctx.vehicleClass} is not in declared ODD classes [${odd.vehicleClass.join(", ")}].`,
    });
  }
  if (!odd.roadClass.includes(ctx.roadClass)) {
    reasons.push({
      code: "road-class-out-of-envelope",
      message: `Road class ${ctx.roadClass} is not in declared ODD road classes [${odd.roadClass.join(", ")}].`,
    });
  }
  if (ctx.proposedSpeedKmh > odd.maxSpeedKmh) {
    reasons.push({
      code: "speed-exceeds-envelope",
      message: `Proposed speed ${ctx.proposedSpeedKmh} km/h exceeds ODD limit ${odd.maxSpeedKmh} km/h.`,
    });
  }
  if (odd.geofenceId !== undefined) {
    if (ctx.geofenceId === undefined || ctx.geofenceId !== odd.geofenceId) {
      reasons.push({
        code: "geofence-mismatch",
        message: `Geofence ${ctx.geofenceId ?? "<none>"} does not match declared ODD geofence ${odd.geofenceId}.`,
      });
    }
  }

  if (reasons.length === 0) return { ok: true };
  return { ok: false, reasons };
}

/**
 * Typed error thrown by `requireOdd()`. Carries the structured violation list
 * so upstream handlers can render it (UI, decision log, audit chain) without
 * string-parsing.
 */
export class OddViolation extends Error {
  override readonly name = "OddViolation";
  readonly code = "odd-violation" as const;
  readonly reasons: OddViolationReason[];

  constructor(reasons: OddViolationReason[]) {
    super(
      `Operational Design Domain not satisfied: ${reasons.map((r) => r.code).join(", ")}`,
    );
    this.reasons = reasons;
  }
}

/**
 * The universal gate. Call this at the entry of every autonomous-decision
 * code path. Throws OddViolation when the context falls outside the declared
 * ODD; never returns false. Fail-closed by construction.
 */
export function requireOdd(
  odd: OperationalDesignDomain,
  ctx: OperationalContext,
): void {
  const verdict = oddSatisfied(odd, ctx);
  if (!verdict.ok) throw new OddViolation(verdict.reasons);
}

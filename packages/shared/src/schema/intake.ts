import { z } from "zod";
import {
  VehicleIdentitySchema,
  VehicleIdentityBaseSchema,
  ServiceHistorySchema,
} from "./vehicle.js";

// =============================================================================
// Intake schema — the full structured capture for a service booking.
// The list of fields is the exhaustive enumeration from docs/research/automotive.md §8.
// =============================================================================

/**
 * E.164 phone number validator.
 * Reference: ITU-T E.164.
 */
export const E164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Must be an E.164 international phone number");

export const LocaleSchema = z.enum([
  "en",
  "hi",
  "ta",
  "te",
  "bn",
  "mr",
  "gu",
  "kn",
  "ml",
  "pa",
]);

export const OwnerSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  phone: E164Schema,
  email: z.string().email().optional(),
  preferredLocale: LocaleSchema.default("en"),
  preferredChannel: z
    .enum(["app", "sms", "whatsapp", "email", "voice"])
    .default("app"),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: E164Schema.optional(),
});
export type Owner = z.infer<typeof OwnerSchema>;

export const IssueCategorySchema = z.enum([
  "noise",
  "vibration",
  "smell",
  "leak",
  "warning-light",
  "performance",
  "cosmetic",
  "scheduled-maintenance",
  "accident",
  "recall",
  "unknown",
]);

export const NoiseOccurrenceSchema = z.enum([
  "cold-start",
  "idle",
  "acceleration",
  "braking",
  "steady-speed",
  "turning",
  "over-bumps",
  "under-load",
  "intermittent",
]);

export const NoiseLocationSchema = z.enum([
  "front-left",
  "front-right",
  "rear-left",
  "rear-right",
  "front-centre",
  "rear-centre",
  "under-hood",
  "under-car",
  "cabin",
  "unknown",
]);

export const WarningLightStateSchema = z.object({
  colour: z.enum(["red", "amber", "green", "blue", "unknown"]),
  name: z.string().max(80).optional(),
  flashing: z.boolean().default(false),
  clusterPhotoRef: z.string().url().optional(),
});

export const PerformanceSymptomSchema = z.enum([
  "loss-of-power",
  "rough-idle",
  "stall",
  "hard-start",
  "no-start",
  "misfire",
  "overheating",
  "transmission-slip",
  "abs-tcs-active",
  "steering-pull",
  "brake-fade",
  "regen-weak",
  "range-reduction",
]);

export const IssueSchema = z.object({
  freeText: z.string().max(2_000),
  tags: z.array(IssueCategorySchema).max(5).default([]),
  startedAt: z.string().datetime().optional(),
  frequency: z
    .enum(["constant", "intermittent", "once", "worsening"])
    .optional(),
  noise: z
    .object({
      occurrence: z.array(NoiseOccurrenceSchema).default([]),
      location: NoiseLocationSchema.optional(),
      audioRef: z.string().url().optional(),
    })
    .partial()
    .optional(),
  warningLights: z.array(WarningLightStateSchema).max(20).default([]),
  performance: z.array(PerformanceSymptomSchema).default([]),
  photos: z.array(z.string().url()).max(10).default([]),
});
export type Issue = z.infer<typeof IssueSchema>;

/**
 * Self-reported safety assessment by the owner. The booleans here feed the
 * hard-coded safety red-flag list in `safety.ts`. Any `true` value in the
 * redFlags array forces a tow, per docs/research/wellbeing.md §4.
 */
export const SelfSafetySchema = z.object({
  canDriveSafely: z.enum([
    "yes-confidently",
    "yes-cautiously",
    "unsure",
    "no",
    "already-stranded",
  ]),
  redFlags: z
    .array(
      z.enum([
        "brake-failure",
        "steering-failure",
        "engine-fire",
        "visible-smoke-from-hood",
        "fluid-puddle-large",
        "coolant-boiling",
        "oil-pressure-red-light",
        "airbag-deployed-recent",
        "ev-battery-thermal-warning",
        "driver-reports-unsafe",
      ]),
    )
    .default([]),
});
export type SelfSafety = z.infer<typeof SelfSafetySchema>;

export const PickupModeSchema = z.enum([
  "drive-in",
  "mobile-mechanic",
  "tow",
  "pickup-drop",
  "autonomous-tier-a",
]);

export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(300).optional(),
  plusCode: z.string().max(20).optional(),
});

export const TimeWindowSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  })
  .refine((w) => new Date(w.end) > new Date(w.start), {
    message: "Window end must be after start",
  });

export const LogisticsSchema = z.object({
  preferredMode: PickupModeSchema,
  customerLocation: LocationSchema,
  preferredWindow: TimeWindowSchema,
  alternateWindow: TimeWindowSchema.optional(),
  needLoaner: z.boolean().default(false),
  wantDetailedQuoteFirst: z.boolean().default(true),
  acceptablePartGrade: z
    .array(z.enum(["oem", "oes", "aftermarket-top", "aftermarket-budget"]))
    .default(["oem", "oes"]),
  budgetCeilingInr: z.number().nonnegative().optional(),
});
export type Logistics = z.infer<typeof LogisticsSchema>;

export const IntakeDraftSchema = z.object({
  draftId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  owner: OwnerSchema.partial(),
  vehicle: VehicleIdentityBaseSchema.partial().optional(),
  history: ServiceHistorySchema.partial().optional(),
  issue: IssueSchema.partial().optional(),
  safety: SelfSafetySchema.partial().optional(),
  logistics: LogisticsSchema.partial().optional(),
});
export type IntakeDraft = z.infer<typeof IntakeDraftSchema>;

/**
 * The fully-committed Intake. This is what the dispatch solver and the
 * work-order generator consume. Every optional field on the draft is now
 * required (or explicitly marked not-applicable).
 */
export const IntakeSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  owner: OwnerSchema,
  vehicle: VehicleIdentitySchema,
  history: ServiceHistorySchema,
  issue: IssueSchema,
  safety: SelfSafetySchema,
  logistics: LogisticsSchema,
  consentVersion: z.string().min(1),
  aiDecisionLogId: z.string().uuid(),
});
export type Intake = z.infer<typeof IntakeSchema>;

import { z } from "zod";
import { LocationSchema, TimeWindowSchema } from "./intake.js";

export const ServiceSkillSchema = z.enum([
  "engine",
  "transmission",
  "electrical",
  "hybrid-ev",
  "hv-battery",
  "adas",
  "brakes",
  "steering-suspension",
  "body-paint",
  "tyres-wheels-alignment",
  "ac-hvac",
  "software-update",
  "tuning-remap",
  "bike-2w",
]);
export type ServiceSkill = z.infer<typeof ServiceSkillSchema>;

export const ServiceCenterSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: LocationSchema,
  skills: z.array(ServiceSkillSchema).min(1),
  capacityPerHour: z.number().int().positive(),
  currentLoadPerHour: z.number().int().nonnegative(),
  loanerAvailable: z.boolean(),
  historicalCsat: z.number().min(0).max(5).optional(),
  openWindows: z.array(TimeWindowSchema).default([]),
  placeId: z.string().optional(),
});
export type ServiceCenter = z.infer<typeof ServiceCenterSchema>;

export const MobileMechanicSchema = z.object({
  id: z.string(),
  name: z.string(),
  currentLocation: LocationSchema,
  skills: z.array(ServiceSkillSchema).min(1),
  remainingCapacity: z.number().int().nonnegative(),
  workingWindow: TimeWindowSchema,
  historicalCsat: z.number().min(0).max(5).optional(),
});
export type MobileMechanic = z.infer<typeof MobileMechanicSchema>;

export const DispatchModeSchema = z.enum([
  "drive-in",
  "mobile",
  "tow",
  "autonomous-tier-a",
]);

export const DispatchDecisionSchema = z.object({
  id: z.string().uuid(),
  intakeId: z.string().uuid(),
  mode: DispatchModeSchema,
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("service-center"),
      ref: ServiceCenterSchema,
      slot: TimeWindowSchema,
    }),
    z.object({
      kind: z.literal("mobile-mechanic"),
      ref: MobileMechanicSchema,
      slot: TimeWindowSchema,
    }),
    z.object({
      kind: z.literal("tow-then-center"),
      towProvider: z.string(),
      ref: ServiceCenterSchema,
      etaMinutes: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal("autonomous-avp"),
      ref: ServiceCenterSchema,
      provider: z.string(),
      slot: TimeWindowSchema,
    }),
  ]),
  objectiveScore: z.number(),
  wellbeingScore: z.number().min(0).max(1),
  estimatedTravelMinutes: z.number().nonnegative(),
  estimatedWaitMinutes: z.number().nonnegative(),
  estimatedRepairMinutes: z.number().nonnegative(),
  estimatedCostInrRange: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  explanation: z.array(z.string()).min(1),
  alternatives: z.array(z.string().uuid()).default([]),
  createdAt: z.string().datetime(),
});
export type DispatchDecision = z.infer<typeof DispatchDecisionSchema>;

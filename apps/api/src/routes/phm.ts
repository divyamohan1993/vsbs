// =============================================================================
// /v1/phm — actions evaluator and CARLA-demo booking trigger.
//
// Author: Divya Mohan / dmj.one
// SPDX-License-Identifier: Apache-2.0
//
// The "trigger" path takes a critical PHM reading and *drafts* the booking
// the concierge would mint, including the part list the failure implies.
// It does not call the LangGraph supervisor — that's reserved for owner-
// initiated turns. The CARLA orchestrator uses this route in the demo loop
// so the headline scenario stays deterministic.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";

import {
  PhmReadingSchema,
  phmAction,
  type ComponentId,
  type PhmReading,
} from "@vsbs/shared";
import { zv } from "../middleware/zv.js";
import { errBody, type AppEnv } from "../middleware/security.js";

export const PhmEvalSchema = z.object({
  readings: z.array(PhmReadingSchema).min(1),
  inMotion: z.boolean(),
});

const TriggerBodySchema = z.object({
  vehicleId: z.string().min(1),
  reading: PhmReadingSchema,
  inMotion: z.boolean().default(true),
});

export interface PhmTriggerSpec {
  symptom: string;
  requiredParts: string[];
  serviceSkill: string;
  redFlag: string | null;
  severity: "red" | "amber" | "green";
}

const TRIGGER_BY_COMPONENT: Partial<Record<ComponentId, PhmTriggerSpec>> = {
  "brakes-pads-front": {
    symptom: "Front brake-pad wear is past minimum thickness — pedal feel and stopping distance compromised.",
    requiredParts: ["BOSCH-BP1234"],
    serviceSkill: "brakes",
    redFlag: "brake-failure",
    severity: "amber",
  },
  "brakes-pads-rear": {
    symptom: "Rear brake-pad wear is past minimum thickness.",
    requiredParts: ["ATE-13.0460-2782.2"],
    serviceSkill: "brakes",
    redFlag: null,
    severity: "amber",
  },
  "brakes-hydraulic": {
    symptom: "Brake hydraulic pressure has dropped — hydraulic failure suspected.",
    requiredParts: ["BOSCH-BP1234"],
    serviceSkill: "brakes",
    redFlag: "brake-failure",
    severity: "red",
  },
  "cooling-system": {
    symptom: "Coolant temperature trending past safe envelope — overheat risk.",
    requiredParts: ["TESLA-COOL-KIT-M3-2024"],
    serviceSkill: "engine",
    redFlag: "coolant-boiling",
    severity: "amber",
  },
  "engine-oil-system": {
    symptom: "Engine oil age and pressure indicate change is overdue.",
    requiredParts: ["BOSCH-0451103300"],
    serviceSkill: "engine",
    redFlag: null,
    severity: "amber",
  },
  "battery-12v": {
    symptom: "12V battery state of health is degraded — start failure expected.",
    requiredParts: ["EXIDE-MX-7"],
    serviceSkill: "electrical",
    redFlag: null,
    severity: "amber",
  },
  "battery-hv": {
    symptom: "HV battery cell imbalance has crossed the alarm threshold.",
    requiredParts: ["MERC-EQS-CELL-MOD-A1"],
    serviceSkill: "hv-battery",
    redFlag: "ev-battery-thermal-warning",
    severity: "red",
  },
  "drive-belt": {
    symptom: "Drive-belt cracking signature detected — replace before failure.",
    requiredParts: ["GATES-K060842"],
    serviceSkill: "engine",
    redFlag: null,
    severity: "amber",
  },
  "wheel-bearings": {
    symptom: "Front wheel-bearing roughness exceeds ISO 10816 vibration band.",
    requiredParts: ["SKF-VKBA-3525"],
    serviceSkill: "steering-suspension",
    redFlag: null,
    severity: "amber",
  },
  "tire-fl": {
    symptom: "Front-left tyre wear / pressure outside safe range.",
    requiredParts: ["MRF-ZSLK-205-55-16"],
    serviceSkill: "tyres-wheels-alignment",
    redFlag: null,
    severity: "amber",
  },
  "tire-fr": {
    symptom: "Front-right tyre wear / pressure outside safe range.",
    requiredParts: ["MRF-ZSLK-205-55-16"],
    serviceSkill: "tyres-wheels-alignment",
    redFlag: null,
    severity: "amber",
  },
  "tire-rl": {
    symptom: "Rear-left tyre wear / pressure outside safe range.",
    requiredParts: ["MRF-ZSLK-205-55-16"],
    serviceSkill: "tyres-wheels-alignment",
    redFlag: null,
    severity: "amber",
  },
  "tire-rr": {
    symptom: "Rear-right tyre wear / pressure outside safe range.",
    requiredParts: ["MRF-ZSLK-205-55-16"],
    serviceSkill: "tyres-wheels-alignment",
    redFlag: null,
    severity: "amber",
  },
};

export function lookupPhmTrigger(component: ComponentId): PhmTriggerSpec | undefined {
  return TRIGGER_BY_COMPONENT[component];
}

export function draftBookingFromPhm(reading: PhmReading): {
  spec: PhmTriggerSpec;
  draft: {
    vehicleId: string;
    issue: { symptoms: string; canDriveSafely: "yes-cautiously" | "no" | "unsure"; redFlags: string[] };
    safety: { severity: "red" | "amber" | "green"; rationale: string; triggered: string[] };
    requiredParts: string[];
    serviceSkill: string;
  };
} {
  const spec = TRIGGER_BY_COMPONENT[reading.component];
  if (!spec) throw new Error(`no trigger spec for component ${reading.component}`);
  const action = phmAction(reading, true);
  let severity = spec.severity;
  let canDrive: "yes-cautiously" | "no" | "unsure" = "yes-cautiously";
  if (action.kind === "takeover-required-and-block-autonomy" || action.kind === "manual-drive-to-shop") {
    severity = "red";
    canDrive = "no";
  } else if (reading.state === "critical" || reading.state === "unsafe") {
    severity = "red";
    canDrive = "unsure";
  }
  const triggered = spec.redFlag ? [spec.redFlag] : [];
  return {
    spec,
    draft: {
      vehicleId: reading.vehicleId,
      issue: {
        symptoms: spec.symptom,
        canDriveSafely: canDrive,
        redFlags: triggered,
      },
      safety: {
        severity,
        rationale: `PHM ${reading.modelSource} model reports ${reading.component} state=${reading.state}, p_fail_lower=${reading.pFailLower.toFixed(3)}.`,
        triggered,
      },
      requiredParts: spec.requiredParts,
      serviceSkill: spec.serviceSkill,
    },
  };
}

export function buildPhmRouter() {
  const router = new Hono<AppEnv>();

  router.post("/actions", zv("json", PhmEvalSchema), (c) => {
    const { readings, inMotion } = c.req.valid("json");
    const actions = readings.map((r) => ({ component: r.component, action: phmAction(r, inMotion) }));
    return c.json({ data: { actions } });
  });

  router.post(
    "/:vehicleId/triggers/booking",
    zv("param", z.object({ vehicleId: z.string().min(1) })),
    zv("json", TriggerBodySchema),
    (c) => {
      const { vehicleId } = c.req.valid("param");
      const body = c.req.valid("json");
      if (body.vehicleId !== vehicleId) {
        return c.json(
          errBody("VEHICLE_ID_MISMATCH", "Path and body vehicleId disagree", c),
          400,
        );
      }
      try {
        const { spec, draft } = draftBookingFromPhm(body.reading);
        return c.json({ data: { spec, draft, action: phmAction(body.reading, body.inMotion) } }, 201);
      } catch (err) {
        return c.json(errBody("PHM_TRIGGER_UNSUPPORTED", String(err), c), 422);
      }
    },
  );

  return router;
}

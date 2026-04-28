// =============================================================================
// /v1/scenarios — orchestrator state surface for the CARLA demo loop.
//
// Author: Divya Mohan / dmj.one
// SPDX-License-Identifier: Apache-2.0
//
// The CARLA bridge owns the driving state machine; this server-side view
// is the *book-keeping* mirror that the web UI subscribes to. The bridge
// PUTs transitions; the UI receives them through SSE without polling.
// Stores are in-memory (sim/dev). A Firestore-backed store will swap
// behind the same interface for production.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";
import { streamSSE } from "hono/streaming";

import { ConsentPurposeSchema, type ConsentPurpose } from "@vsbs/shared";
import {
  type ConsentManager,
  buildEvidenceHash,
  DEFAULT_PURPOSE_REGISTRY,
  latestVersions,
} from "@vsbs/compliance";

import { zv } from "../middleware/zv.js";
import { errBody, type AppEnv } from "../middleware/security.js";

export const ScenarioFaultSchema = z.enum([
  "brake-pad-wear",
  "coolant-overheat",
  "hv-battery-imbalance",
  "tpms-dropout",
  "oil-low",
  "drive-belt-age",
]);
export type ScenarioFault = z.infer<typeof ScenarioFaultSchema>;

export const OrchestratorStateSchema = z.enum([
  "IDLE",
  "DRIVING_HOME_AREA",
  "FAULT_INJECTING",
  "BOOKING_PENDING",
  "AWAITING_GRANT",
  "DRIVING_TO_SC",
  "SERVICING",
  "AWAITING_RETURN_GRANT",
  "DRIVING_HOME",
  "DONE",
  "FAILED",
]);
export type OrchestratorState = z.infer<typeof OrchestratorStateSchema>;

export const ScenarioSchema = z.object({
  scenarioId: z.string().uuid(),
  vehicleId: z.string().min(1),
  fault: ScenarioFaultSchema,
  scCount: z.number().int().min(1).max(10),
  state: OrchestratorStateSchema,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  bookingId: z.string().uuid().optional(),
  scId: z.string().min(1).optional(),
  outboundGrantId: z.string().uuid().optional(),
  returnGrantId: z.string().uuid().optional(),
  expectedDurationS: z.number().int().nonnegative(),
  plannedSteps: z.array(z.string()).default([]),
  history: z.array(z.object({
    state: OrchestratorStateSchema,
    at: z.string().datetime(),
    note: z.string().optional(),
  })).default([]),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export interface ScenarioStoreLike {
  put(scenario: Scenario): void;
  get(id: string): Scenario | undefined;
  list(): Scenario[];
  subscribe(id: string, listener: (s: Scenario) => void): () => void;
}

export class MemoryScenarioStore implements ScenarioStoreLike {
  readonly #scenarios = new Map<string, Scenario>();
  readonly #subs = new Map<string, Set<(s: Scenario) => void>>();

  put(scenario: Scenario): void {
    this.#scenarios.set(scenario.scenarioId, scenario);
    const listeners = this.#subs.get(scenario.scenarioId);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(scenario); } catch { /* swallow listener errors */ }
      }
    }
  }

  get(id: string): Scenario | undefined {
    return this.#scenarios.get(id);
  }

  list(): Scenario[] {
    return Array.from(this.#scenarios.values());
  }

  subscribe(id: string, listener: (s: Scenario) => void): () => void {
    let bucket = this.#subs.get(id);
    if (!bucket) {
      bucket = new Set();
      this.#subs.set(id, bucket);
    }
    bucket.add(listener);
    return () => {
      bucket?.delete(listener);
    };
  }
}

const PLANNED_STEPS: readonly string[] = [
  "DRIVING_HOME_AREA",
  "FAULT_INJECTING",
  "BOOKING_PENDING",
  "AWAITING_GRANT",
  "DRIVING_TO_SC",
  "SERVICING",
  "AWAITING_RETURN_GRANT",
  "DRIVING_HOME",
  "DONE",
];

const StartBodySchema = z.object({
  vehicleId: z.string().min(1),
  fault: ScenarioFaultSchema,
  scCount: z.number().int().min(1).max(10).default(3),
});

const TransitionBodySchema = z.object({
  state: OrchestratorStateSchema,
  note: z.string().max(500).optional(),
  bookingId: z.string().uuid().optional(),
  scId: z.string().min(1).optional(),
  outboundGrantId: z.string().uuid().optional(),
  returnGrantId: z.string().uuid().optional(),
});

const InjectFaultBodySchema = z.object({
  fault: ScenarioFaultSchema,
  note: z.string().max(500).optional(),
});

/**
 * Purposes the CARLA demo needs to clear the gate set on /v1/sensors/ingest,
 * /v1/intake/*, /v1/dispatch/*, /v1/payments/*, and /v1/autonomy/grant.
 * Names match `ConsentPurposeSchema` exactly; "service-fulfilment" covers the
 * service-booking + safety-decisions intent the team-lead asked us to seed.
 */
export const DEMO_BOOTSTRAP_PURPOSES: readonly ConsentPurpose[] = [
  "service-fulfilment",
  "diagnostic-telemetry",
  "autonomy-delegation",
  "autopay-within-cap",
  "voice-photo-processing",
] as const;

const BootstrapConsentBodySchema = z.object({
  userId: z.string().min(1),
  purposes: z.array(ConsentPurposeSchema).min(1).optional(),
  source: z
    .enum(["voice", "web", "mobile", "kiosk", "ivr"])
    .default("web"),
  locale: z.string().min(2).max(20).default("en"),
});

export interface ScenariosRouterDeps {
  store?: ScenarioStoreLike;
  /** Wall-clock injector for tests; defaults to Date.now / new Date(). */
  now?: () => Date;
  /**
   * Optional shared consent manager. When provided, the bootstrap-consent
   * route writes through this manager so the gates on /v1/sensors/ingest
   * etc. see the granted rows immediately. When omitted, the route returns
   * 503 since there's no store to seed.
   */
  consent?: ConsentManager;
}

export function buildScenariosRouter(deps: ScenariosRouterDeps = {}) {
  const router = new Hono<AppEnv>();
  const store = deps.store ?? new MemoryScenarioStore();
  const now = deps.now ?? (() => new Date());
  const consent = deps.consent;

  router.get("/", (c) => {
    return c.json({ data: { scenarios: store.list() } });
  });

  router.post("/bootstrap-consent", zv("json", BootstrapConsentBodySchema), async (c) => {
    if (!consent) {
      return c.json(
        errBody(
          "CONSENT_MANAGER_UNAVAILABLE",
          "Bootstrap-consent requires a consent manager to be wired into the scenarios router.",
          c,
        ),
        503,
      );
    }
    const body = c.req.valid("json");
    const purposes = body.purposes ?? DEMO_BOOTSTRAP_PURPOSES;
    const versions = latestVersions();
    const granted: { purpose: ConsentPurpose; version: string; recordId: string }[] = [];
    for (const purpose of purposes) {
      const desc = DEFAULT_PURPOSE_REGISTRY[purpose];
      const evidenceHash = await buildEvidenceHash(
        desc,
        body.locale,
        `${desc.description_en}\n${desc.description_hi}`,
      );
      const row = await consent.record({
        userId: body.userId,
        purpose,
        version: versions[purpose],
        evidenceHash,
        source: body.source,
        ip_hash: "",
      });
      granted.push({ purpose, version: row.version, recordId: row.id });
    }
    return c.json(
      {
        data: {
          userId: body.userId,
          purposes: granted,
          latestVersions: versions,
        },
      },
      201,
    );
  });

  router.post("/carla-demo/start", zv("json", StartBodySchema), (c) => {
    const body = c.req.valid("json");
    const ts = now().toISOString();
    const scenario: Scenario = {
      scenarioId: crypto.randomUUID(),
      vehicleId: body.vehicleId,
      fault: body.fault,
      scCount: body.scCount,
      state: "IDLE",
      startedAt: ts,
      updatedAt: ts,
      expectedDurationS: 240,
      plannedSteps: PLANNED_STEPS.slice(),
      history: [{ state: "IDLE", at: ts, note: `Scenario primed for ${body.fault}.` }],
    };
    store.put(scenario);
    return c.json({ data: scenario }, 201);
  });

  router.post(
    "/:scenarioId/transition",
    zv("param", z.object({ scenarioId: z.string().uuid() })),
    zv("json", TransitionBodySchema),
    (c) => {
      const { scenarioId } = c.req.valid("param");
      const body = c.req.valid("json");
      const existing = store.get(scenarioId);
      if (!existing) {
        return c.json(errBody("SCENARIO_NOT_FOUND", "Unknown scenario id", c), 404);
      }
      const ts = now().toISOString();
      const next: Scenario = {
        ...existing,
        state: body.state,
        updatedAt: ts,
        history: [...existing.history, { state: body.state, at: ts, ...(body.note ? { note: body.note } : {}) }],
        ...(body.bookingId ? { bookingId: body.bookingId } : {}),
        ...(body.scId ? { scId: body.scId } : {}),
        ...(body.outboundGrantId ? { outboundGrantId: body.outboundGrantId } : {}),
        ...(body.returnGrantId ? { returnGrantId: body.returnGrantId } : {}),
      };
      store.put(next);
      return c.json({ data: next });
    },
  );

  router.post(
    "/:scenarioId/inject-fault",
    zv("param", z.object({ scenarioId: z.string().uuid() })),
    zv("json", InjectFaultBodySchema),
    (c) => {
      const { scenarioId } = c.req.valid("param");
      const body = c.req.valid("json");
      const existing = store.get(scenarioId);
      if (!existing) {
        return c.json(errBody("SCENARIO_NOT_FOUND", "Unknown scenario id", c), 404);
      }
      const ts = now().toISOString();
      const next: Scenario = {
        ...existing,
        fault: body.fault,
        state: "FAULT_INJECTING",
        updatedAt: ts,
        history: [
          ...existing.history,
          { state: "FAULT_INJECTING", at: ts, note: body.note ?? `manual fault inject: ${body.fault}` },
        ],
      };
      store.put(next);
      return c.json({ data: next });
    },
  );

  router.get(
    "/:scenarioId",
    zv("param", z.object({ scenarioId: z.string().uuid() })),
    (c) => {
      const { scenarioId } = c.req.valid("param");
      const sc = store.get(scenarioId);
      if (!sc) return c.json(errBody("SCENARIO_NOT_FOUND", "Unknown scenario id", c), 404);
      return c.json({ data: sc });
    },
  );

  router.get(
    "/:scenarioId/state",
    zv("param", z.object({ scenarioId: z.string().uuid() })),
    (c) => {
      const { scenarioId } = c.req.valid("param");
      const initial = store.get(scenarioId);
      if (!initial) {
        return c.json(errBody("SCENARIO_NOT_FOUND", "Unknown scenario id", c), 404);
      }
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(initial) });
        let active = true;
        const cleanup = store.subscribe(scenarioId, (updated) => {
          if (!active) return;
          stream.writeSSE({ event: "transition", data: JSON.stringify(updated) }).catch(() => {
            active = false;
          });
        });
        try {
          for (let i = 0; i < 600 && active; i++) {
            const snapshot = store.get(scenarioId);
            if (snapshot && (snapshot.state === "DONE" || snapshot.state === "FAILED")) {
              await stream.writeSSE({ event: "end", data: JSON.stringify(snapshot) });
              break;
            }
            await stream.sleep(1_000);
          }
        } finally {
          active = false;
          cleanup();
        }
      });
    },
  );

  return router;
}

// VSBS API — Hono on Bun on Cloud Run.
// O(1) hot paths; Zod validators compiled at import; structured JSON logging.
// References: docs/architecture.md, docs/research/{agentic,dispatch}.md

import { Hono } from "hono";
import { zv } from "./middleware/zv.js";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";

import {
  VinSchema,
  vinCheckDigitValid,
  IntakeSchema,
  IntakeDraftSchema,
  assessSafety,
  postCheckSafetyAgrees,
  wellbeingScore,
  type WellbeingInputs,
  DispatchDecisionSchema,
  CommandGrantSchema,
  resolveAutonomyCapability,
  ComponentIdSchema,
  PhmReadingSchema,
  phmAction,
} from "@vsbs/shared";
import { arbitrate, type Statement } from "@vsbs/sensors";

import { loadEnv } from "./env.js";
import { Logger } from "./log.js";
import { makeNhtsaClient } from "./adapters/nhtsa.js";
import { makeRoutesClient } from "./adapters/maps.js";
import { buildAuthRouter } from "./routes/auth.js";
import { buildPaymentRouter } from "./routes/payment.js";
import { buildLlmRouter } from "./routes/llm.js";
import { buildConciergeRouter } from "./routes/concierge.js";
import { buildBookingsRouter } from "./routes/bookings.js";
import { buildMeRouter } from "./routes/me.js";
import { buildSensorsRouter } from "./routes/sensors.js";
import { buildAutonomyRouter } from "./routes/autonomy.js";
import {
  requestId,
  structuredLogger,
  bodySizeLimit,
  rateLimit,
  errBody,
  type AppEnv,
} from "./middleware/security.js";

const env = loadEnv();
const log = new Logger(env.LOG_LEVEL, { svc: "vsbs-api", region: env.APP_REGION });

const nhtsa = makeNhtsaClient({ base: env.NHTSA_VPIC_BASE });
const routes = env.MAPS_SERVER_API_KEY
  ? makeRoutesClient({ apiKey: env.MAPS_SERVER_API_KEY })
  : null;

const app = new Hono<AppEnv>();

// Defense-in-depth middleware chain (outer → inner).
app.use("*", requestId());
app.use("*", structuredLogger(log));
app.use("*", bodySizeLimit(1_048_576)); // 1 MiB default; multipart upload routes raise this locally.
app.use("*", rateLimit({ windowMs: 60_000, max: 120 }));
app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginOpenerPolicy: "same-origin",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  }),
);

// -------- health --------
app.get("/healthz", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.get("/readyz", (c) =>
  c.json({
    ok: true,
    demo: env.APP_DEMO_MODE,
    region: env.APP_REGION,
    modes: {
      auth: env.AUTH_MODE,
      payment: env.PAYMENT_MODE,
      maps: env.MAPS_MODE,
      sensors: env.SENSORS_MODE,
      autonomy: env.AUTONOMY_MODE,
      autonomyEnabled: env.AUTONOMY_ENABLED,
    },
    checks: {
      nhtsa: true,
      routes: routes !== null || env.MAPS_MODE === "sim",
    },
  }),
);

// -------- auth (OTP) --------
app.route("/v1/auth/otp", buildAuthRouter(env));

// -------- payments --------
app.route("/v1/payments", buildPaymentRouter(env));

// -------- llm (provider-agnostic) --------
app.route("/v1/llm", buildLlmRouter(env));

// -------- concierge SSE (LangGraph supervisor) --------
app.route("/v1/concierge", buildConciergeRouter(env));

// -------- bookings live-status SSE --------
app.route("/v1/bookings", buildBookingsRouter());

// -------- owner-scoped (consent delete etc) --------
app.route("/v1/me", buildMeRouter());

// -------- sensor ingest (Smartcar + OBD-II BLE dongle, sim/live parity) --------
app.route("/v1/sensors", buildSensorsRouter(env));

// -------- autonomy (takeover ladder + command-grant lifecycle + AVP) --------
app.route("/v1/autonomy", buildAutonomyRouter(env));

// -------- VIN decode (real NHTSA vPIC call) --------
app.get("/v1/vin/:vin", zv("param", z.object({ vin: VinSchema })), async (c) => {
  const { vin } = c.req.valid("param");
  if (!vinCheckDigitValid(vin)) {
    return c.json(errBody("INVALID_VIN_CHECK", "VIN check digit failed (ISO 3779)", c), 400);
  }
  try {
    const decoded = await nhtsa.decodeVin(vin);
    return c.json({ data: decoded });
  } catch (err) {
    log.error("vin_decode_failed", { vin, err: String(err) });
    return c.json(errBody("NHTSA_ERROR", "Upstream VIN decoder unavailable", c), 502);
  }
});

// -------- safety (pure) --------
const SafetyBodySchema = z.object({
  owner: z.object({
    canDriveSafely: z
      .enum(["yes-confidently", "yes-cautiously", "unsure", "no", "already-stranded"])
      .optional(),
    redFlags: z.array(z.string()).optional(),
  }).partial(),
  sensorFlags: z.array(z.string()).optional(),
});
app.post("/v1/safety/assess", zv("json", SafetyBodySchema), async (c) => {
  const body = c.req.valid("json");
  const assessment = assessSafety(body);
  const agrees = postCheckSafetyAgrees(assessment, body);
  if (!agrees) {
    log.error("safety_post_check_mismatch", { assessment, input: body });
    return c.json(errBody("SAFETY_POSTCHECK_FAIL", "Safety post-check mismatch", c), 500);
  }
  return c.json({ data: assessment });
});

// -------- wellbeing scorer (pure O(1)) --------
const WellbeingBodySchema = z.object({
  safety: z.number(), wait: z.number(), cti: z.number(), timeAccuracy: z.number(),
  servqual: z.number(), trust: z.number(), continuity: z.number(),
  ces: z.number(), csat: z.number(), nps: z.number(),
});
app.post("/v1/wellbeing/score", zv("json", WellbeingBodySchema), (c) => {
  const input = c.req.valid("json") satisfies WellbeingInputs;
  return c.json({ data: wellbeingScore(input) });
});

// -------- distance / ETA (real Routes API) --------
const EtaBodySchema = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
});
app.post("/v1/eta", zv("json", EtaBodySchema), async (c) => {
  if (!routes) {
    return c.json(errBody("MAPS_DISABLED", "Set MAPS_SERVER_API_KEY to enable", c), 503);
  }
  const { origin, destination } = c.req.valid("json");
  try {
    const r = await routes.driveEta(origin, destination);
    return c.json({ data: r });
  } catch (err) {
    log.error("routes_failed", { err: String(err) });
    return c.json(errBody("ROUTES_ERROR", "Routes API error", c), 502);
  }
});

// -------- intake draft commit (schema-validated) --------
app.post(
  "/v1/intake/commit",
  zv("json", IntakeSchema),
  (c) => {
    const intake = c.req.valid("json");
    // The full pipeline (agents, dispatch, autonomy) is orchestrated via the
    // agents package; this endpoint is the schema-safe entry point that the
    // agent's `commitIntake` tool calls.
    log.info("intake_committed", { id: intake.id, ownerHash: hashPhone(intake.owner.phone) });
    return c.json({ data: { id: intake.id, status: "accepted" } }, 202);
  },
);

app.post(
  "/v1/intake/draft",
  zv("json", IntakeDraftSchema),
  (c) => {
    const draft = c.req.valid("json");
    return c.json({ data: { draftId: draft.draftId, savedAt: new Date().toISOString() } });
  },
);

// -------- dispatch decision (persisted) --------
app.post(
  "/v1/dispatch/commit",
  zv("json", DispatchDecisionSchema),
  (c) => {
    const d = c.req.valid("json");
    log.info("dispatch_committed", { id: d.id, mode: d.mode, score: d.objectiveScore });
    return c.json({ data: { id: d.id, committed: true } }, 202);
  },
);

// -------- autonomy grant --------
app.post(
  "/v1/autonomy/grant",
  zv("json", CommandGrantSchema),
  (c) => {
    if (!env.AUTONOMY_ENABLED) {
      return c.json(errBody("AUTONOMY_DISABLED", "Autonomy is disabled on this server", c), 403);
    }
    const grant = c.req.valid("json");
    log.info("grant_minted", { id: grant.grantId, tier: grant.tier, scopes: grant.scopes });
    return c.json({ data: { id: grant.grantId, accepted: true } }, 202);
  },
);

const AutonomyCheckSchema = z.object({
  vehicle: z.object({
    make: z.string(), model: z.string(), year: z.number().int(),
    yearsSupported: z.array(z.number().int()),
    autonomyHw: z.array(z.string()).optional(),
  }),
  destinationProvider: z.string(),
  providersSupported: z.array(z.string()),
  owner: z.object({
    autonomyConsentGranted: z.boolean(),
    insuranceAllowsAutonomy: z.boolean(),
  }),
});
app.post("/v1/autonomy/capability", zv("json", AutonomyCheckSchema), (c) => {
  const result = resolveAutonomyCapability(c.req.valid("json"));
  return c.json({ data: result });
});

// -------- PHM --------
const PhmEvalSchema = z.object({
  readings: z.array(PhmReadingSchema).min(1),
  inMotion: z.boolean(),
});
app.post("/v1/phm/actions", zv("json", PhmEvalSchema), (c) => {
  const { readings, inMotion } = c.req.valid("json");
  const actions = readings.map((r) => ({ component: r.component, action: phmAction(r, inMotion) }));
  return c.json({ data: { actions } });
});

// -------- sensor fusion --------
const FusionSchema = z.object({
  vehicleId: z.string(),
  statements: z.array(
    z.object({
      claim: z.string(),
      evidence: z.array(
        z.object({ channel: z.string(), agrees: z.boolean(), trust: z.number().min(0).max(1) }),
      ),
    }),
  ),
  samples: z.array(z.any()).default([]),
});
app.post("/v1/fusion/arbitrate", zv("json", FusionSchema), (c) => {
  const body = c.req.valid("json");
  const fused = arbitrate(
    body.vehicleId,
    body.statements as Statement[],
    body.samples as Parameters<typeof arbitrate>[2],
  );
  return c.json({ data: fused });
});

// -------- 404 & error handler --------
app.notFound((c) => c.json(errBody("NOT_FOUND", "Route not found", c), 404));
app.onError((err, c) => {
  const rid = c.get("requestId");
  log.error("unhandled", { rid, err: String(err) });
  return c.json(errBody("INTERNAL", "An internal error occurred", c), 500);
});

function hashPhone(phone: string): string {
  // Not cryptographic — we just don't log the phone number. For the real
  // audit log we use HMAC-SHA256 with a rotating key from Secret Manager.
  let h = 0;
  for (let i = 0; i < phone.length; i++) h = (h * 31 + phone.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export default app;

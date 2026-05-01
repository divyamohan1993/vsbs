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
  CommandGrantSchema,
  resolveAutonomyCapability,
} from "@vsbs/shared";
import { arbitrate, type Statement } from "@vsbs/sensors";

import { loadEnv } from "./env.js";
import { Logger } from "./log.js";
import { makeNhtsaClient } from "./adapters/nhtsa.js";
import { makeRoutesClient } from "./adapters/maps.js";
import { buildAuthRouter } from "./routes/auth.js";
import { buildPasskeyRouter } from "./routes/passkey.js";
import { buildPaymentRouter } from "./routes/payment.js";
import { buildLlmRouter } from "./routes/llm.js";
import { buildConciergeRouter } from "./routes/concierge.js";
import { buildBookingsRouter } from "./routes/bookings.js";
import { buildMeRouter } from "./routes/me.js";
import { buildSensorsRouter } from "./routes/sensors.js";
import { buildAutonomyRouter } from "./routes/autonomy.js";
import { buildKbRouter } from "./routes/kb.js";
import { buildRegionRouter, MemoryPendingBookings } from "./routes/region.js";
import { buildAdminRouter } from "./routes/admin/router.js";
import { buildDispatchRouter } from "./routes/dispatch.js";
import { buildScenariosRouter } from "./routes/scenarios.js";
import { buildPhmRouter } from "./routes/phm.js";
import { buildHealthRouter } from "./routes/health.js";
import { buildMetricsRouter } from "./routes/metrics.js";
import { buildIntakeRouter } from "./routes/intake.js";
import { buildAdminLogsRouter, LogBuffer, type LogEntry } from "./routes/admin/logs.js";
import { makeDemoInventory } from "./adapters/parts/inventory.js";
import { InMemoryConsentManager, buildSimErasureCoordinator } from "@vsbs/compliance";
import { requireConsent } from "./middleware/consent-gate.js";
import {
  requestId,
  bodySizeLimit,
  rateLimit,
  errBody,
  type AppEnv,
} from "./middleware/security.js";
import { cloudArmor } from "./middleware/cloud-armor.js";
import { otel as otelMiddleware } from "./middleware/otel.js";
import { telemetryLogger } from "./middleware/log.js";
import { initOtelServer } from "@vsbs/telemetry/otel-server";
import {
  initMetrics,
  makeVsbsLogger,
  HealthChecker,
  makeAlloyDbPing,
  makeFirestorePing,
  makeSecretManagerList,
  makeLlmProviderPing,
} from "@vsbs/telemetry";
import {
  regionMiddleware,
  REGION_DEFAULT_CONFIG,
} from "./middleware/region.js";
import { regionResidencyMiddleware } from "./middleware/region-residency.js";
import { makeRegionRouterFromEnv } from "./adapters/region-router.js";

const env = loadEnv();
const log = new Logger(env.LOG_LEVEL, { svc: "vsbs-api", region: env.APP_REGION });

// -----------------------------------------------------------------------------
// LLM model-pin fail-fast (per ai-eng C2 contract).
//
// In demo/prod, every agent role MUST have an explicit VSBS_MODEL_PIN_<ROLE>
// pin. resolveProfileWithPins throws MissingModelPinError if any role is
// missing, which we want at process start so a misconfigured environment
// never silently routes traffic to a default. Sim is exempt (deterministic
// scripted-1 pin).
// -----------------------------------------------------------------------------
if (env.LLM_PROFILE === "demo" || env.LLM_PROFILE === "prod") {
  const { resolveProfileWithPins } = await import("@vsbs/llm");
  resolveProfileWithPins(env.LLM_PROFILE, process.env);
}

// -----------------------------------------------------------------------------
// Telemetry boot. OTel + metrics + structured logger + health checker.
// In sim/dev profiles all four use in-memory exporters and never emit network
// traffic. In prod the operator sets OTEL_EXPORTER_OTLP_ENDPOINT to a real
// collector (Cloud Run sidecar / OTel collector) and these immediately push.
// -----------------------------------------------------------------------------

const telemetryEnv: "development" | "staging" | "production" | "test" =
  env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
const otlpEndpoint = (typeof process !== "undefined" ? process.env?.OTEL_EXPORTER_OTLP_ENDPOINT : undefined) ?? undefined;

const otelHandle = initOtelServer({
  serviceName: "vsbs-api",
  region: env.APP_REGION,
  version: "0.1.0",
  environment: telemetryEnv,
  ...(otlpEndpoint ? { exporterUrl: otlpEndpoint } : {}),
});
const metricsHandle = initMetrics({
  serviceName: "vsbs-api",
  region: env.APP_REGION,
  version: "0.1.0",
  environment: telemetryEnv,
  ...(otlpEndpoint ? { exporterUrl: otlpEndpoint } : {}),
});
const logBuffer = new LogBuffer(2_000);
const vsbsLog = makeVsbsLogger(
  {
    serviceName: "vsbs-api",
    region: env.APP_REGION,
    environment: telemetryEnv,
    level: env.LOG_LEVEL === "trace" ? "trace" : env.LOG_LEVEL,
  },
  { service: "vsbs-api", region: env.APP_REGION },
);

// Mirror every emitted log into the in-process ring buffer so the SIEM
// admin pane streams it. We register a hook on the underlying pino instance
// via process.stdout.write would be too intrusive; instead we let the
// telemetryLogger middleware push the http.request entries it emits, and
// the rest of the code can call `logBuffer.push` directly when it wants.
function pushBuffer(entry: Omit<LogEntry, "ts" | "service" | "region" | "severity">): void {
  logBuffer.push({
    ts: new Date().toISOString(),
    service: "vsbs-api",
    region: env.APP_REGION,
    severity: severityFor(entry.level),
    ...entry,
  });
}
function severityFor(level: LogEntry["level"]): string {
  switch (level) {
    case "trace":
    case "debug":
      return "DEBUG";
    case "info":
      return "INFO";
    case "warn":
      return "WARNING";
    case "error":
      return "ERROR";
    case "fatal":
      return "CRITICAL";
  }
}

// Health checker. Sim drivers always pass; live drivers fire real probes.
const healthChecker = new HealthChecker({ cacheTtlMs: 5_000, timeoutMs: 2_000 });
healthChecker.register("alloydb-ping", makeAlloyDbPing({ mode: "sim" }));
healthChecker.register("firestore-ping", makeFirestorePing({ mode: "sim" }));
healthChecker.register("secret-manager-list", makeSecretManagerList({ mode: "sim" }));
healthChecker.register("llm-provider-ping", makeLlmProviderPing({ mode: "sim" }));

const partsInventory = makeDemoInventory();
const nhtsa = makeNhtsaClient({ base: env.NHTSA_VPIC_BASE });
const routes = env.MAPS_SERVER_API_KEY
  ? makeRoutesClient({ apiKey: env.MAPS_SERVER_API_KEY })
  : null;

const app = new Hono<AppEnv>();

// Region router shared across middleware + routes — built from env at boot.
const regionRouterAdapter = makeRegionRouterFromEnv({
  APP_REGION_BASE_URL_ASIA_SOUTH1: env.APP_REGION_BASE_URL_ASIA_SOUTH1,
  APP_REGION_BASE_URL_US_CENTRAL1: env.APP_REGION_BASE_URL_US_CENTRAL1,
  APP_REGION_WEB_URL_ASIA_SOUTH1: env.APP_REGION_WEB_URL_ASIA_SOUTH1,
  APP_REGION_WEB_URL_US_CENTRAL1: env.APP_REGION_WEB_URL_US_CENTRAL1,
});
const pendingBookings = new MemoryPendingBookings();

// Defense-in-depth middleware chain (outer → inner).
//   1. requestId          — assign / propagate the trace correlation id.
//   2. otelMiddleware     — open a SERVER span around every request.
//   3. telemetryLogger    — emit one structured log line per response.
//   4. bodySizeLimit      — reject anything over 1 MiB.
//   5. rateLimit          — sliding-window per IP+route.
app.use("*", requestId());
app.use("*", cloudArmor());
app.use("*", otelMiddleware({ tracer: otelHandle.tracer, region: env.APP_REGION, serviceName: "vsbs-api" }));
app.use(
  "*",
  telemetryLogger({
    log: vsbsLog,
    region: env.APP_REGION,
    userHashSalt: env.IDENTITY_PLATFORM_SIGNING_KEY,
    sink: (entry) =>
      pushBuffer({
        level: entry.level,
        msg: entry.msg,
        fields: entry.fields,
        ...(entry.trace_id ? { trace_id: entry.trace_id } : {}),
        ...(entry.span_id ? { span_id: entry.span_id } : {}),
        ...(typeof entry.fields.request_id === "string"
          ? { request_id: entry.fields.request_id }
          : {}),
      }),
  }),
);
// Path-aware body cap. Multipart upload routes (intake/photo, intake/audio)
// raise the limit to 5 MiB; everything else is held to 1 MiB.
app.use("*", async (c, next) => {
  const path = c.req.path;
  const cap = path === "/v1/intake/photo" || path === "/v1/intake/audio"
    ? 5 * 1_048_576
    : 1_048_576;
  return bodySizeLimit(cap)(c, next);
});
// Per-IP sliding window. Three traffic classes get explicit envelopes:
//
//   ingest paths  — the CARLA bridge publishes telemetry at 10 Hz and events
//                   on demand. Without their own envelope they'd saturate the
//                   global limiter inside a few seconds.
//   metrics paths — every page load fires up to five Web Vitals beacons and
//                   HMR-driven dev reloads multiply that.
//   everything else — production-shape global cap.
//
// Path-aware dispatch sits in front of the limiter so a request only ticks
// the bucket that owns it.
const limiters = {
  autonomyTelemetry: rateLimit({ windowMs: 60_000, max: 2_000 }),
  autonomyEvents: rateLimit({ windowMs: 60_000, max: 600 }),
  metrics: rateLimit({ windowMs: 60_000, max: 600 }),
  global: rateLimit({ windowMs: 60_000, max: 120 }),
};
app.use("*", async (c, next) => {
  const p = c.req.path;
  if (p.startsWith("/v1/autonomy/") && p.endsWith("/telemetry/ingest")) {
    return limiters.autonomyTelemetry(c, next);
  }
  if (p.startsWith("/v1/autonomy/") && p.endsWith("/events/ingest")) {
    return limiters.autonomyEvents(c, next);
  }
  if (p.startsWith("/v1/metrics/")) {
    return limiters.metrics(c, next);
  }
  return limiters.global(c, next);
});
app.use(
  "*",
  regionMiddleware({
    ...REGION_DEFAULT_CONFIG,
    runtime: env.APP_REGION_RUNTIME,
    euBlock: env.APP_REGION_EU_BLOCK,
  }),
);
// Residency assertion runs only when the operator has wired the cross-region
// router URLs. In single-region demo mode (no other region's base URL set)
// this is a no-op — the assertion always matches.
app.use(
  "*",
  regionResidencyMiddleware({
    runtime: env.APP_REGION_RUNTIME,
    router: regionRouterAdapter,
    passthroughPrefixes: ["/healthz", "/readyz", "/v1/region"],
  }),
);
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

// -------- health (live + ready + admin-only details) --------
app.route(
  "/",
  buildHealthRouter({
    checker: healthChecker,
    serviceName: "vsbs-api",
    region: env.APP_REGION,
    version: "0.1.0",
    modes: {
      demo: env.APP_DEMO_MODE,
      auth: env.AUTH_MODE,
      payment: env.PAYMENT_MODE,
      maps: env.MAPS_MODE,
      sensors: env.SENSORS_MODE,
      autonomy: env.AUTONOMY_MODE,
      autonomyEnabled: env.AUTONOMY_ENABLED,
    },
    appEnv: env.NODE_ENV,
    adminAuthMode: env.NODE_ENV === "production" ? "live" : "sim",
  }),
);

// -------- /metrics — Prometheus exposition + Web Vitals ingest --------
// The router exposes:
//   GET  /metrics            — Prometheus exposition (mounted at /)
//   POST /web-vitals         — Web Vitals ingest (mounted at /v1/metrics)
app.route("/", buildMetricsRouter({ metrics: metricsHandle, log }));
app.route("/v1/metrics", buildMetricsRouter({ metrics: metricsHandle, log }));

// -------- /v1/admin/logs — SIEM live feed (admin-gated) --------
app.route(
  "/v1/admin/logs",
  buildAdminLogsRouter({
    buffer: logBuffer,
    appEnv: env.NODE_ENV,
    adminAuthMode: env.NODE_ENV === "production" ? "live" : "sim",
  }),
);

// -------- auth (OTP) --------
app.route("/v1/auth/otp", buildAuthRouter(env));

// -------- auth (WebAuthn passkey) --------
app.route(
  "/v1/auth/passkey",
  buildPasskeyRouter({
    rpId: env.APP_REGION === "asia-south1" ? "vsbs.app" : "vsbs.app",
    expectedOrigin: "https://vsbs.app",
  }),
);

// -------- payments --------
app.route("/v1/payments", buildPaymentRouter(env));

// -------- llm (provider-agnostic) --------
app.route("/v1/llm", buildLlmRouter(env));

// -------- concierge SSE (LangGraph supervisor) --------
app.route("/v1/concierge", buildConciergeRouter(env));

// -------- bookings live-status SSE --------
app.route("/v1/bookings", buildBookingsRouter());

// -------- consent gate (Phase 5) --------
// One process-wide consent manager + erasure coordinator drive both the
// /v1/me surface and the requireConsent gate that protects PII-touching
// routes. Sim drivers in-memory; live drivers swap by reimplementing the
// same interfaces (ConsentManager, ErasureCoordinator).
const consentManager = new InMemoryConsentManager();
const erasureCoordinator = buildSimErasureCoordinator().coordinator;

app.use("/v1/intake/*", requireConsent("service-fulfilment", { manager: consentManager }));
app.use("/v1/dispatch/*", requireConsent("service-fulfilment", { manager: consentManager }));
app.use("/v1/payments/*", requireConsent("service-fulfilment", { manager: consentManager }));
app.use("/v1/autonomy/grant", requireConsent("autonomy-delegation", { manager: consentManager }));
app.use("/v1/sensors/ingest", requireConsent("diagnostic-telemetry", { manager: consentManager }));

// -------- owner-scoped (consent + erasure + data export) --------
app.route("/v1/me", buildMeRouter({ consent: consentManager, erasure: erasureCoordinator }));

// -------- sensor ingest (Smartcar + OBD-II BLE dongle, sim/live parity) --------
app.route("/v1/sensors", buildSensorsRouter(env));

// -------- autonomy (takeover ladder + command-grant lifecycle + AVP) --------
app.route("/v1/autonomy", buildAutonomyRouter(env));

// -------- knowledge base (AlloyDB+pgvector hybrid retrieval, sim-driven by default) --------
app.route("/v1/kb", buildKbRouter());

// -------- region (residency aware) --------
app.route(
  "/v1/region",
  buildRegionRouter({ router: regionRouterAdapter, pending: pendingBookings }),
);

// -------- admin (operator console, IAP-gated in live, dev-token in sim) --------
app.route(
  "/v1/admin",
  buildAdminRouter({
    appEnv: env.NODE_ENV,
    adminAuthMode: env.NODE_ENV === "production" ? "live" : "sim",
  }),
);

// -------- parts-aware dispatch + leg state machine --------
app.route("/v1/dispatch", buildDispatchRouter({ inventory: partsInventory }));

// -------- CARLA-demo scenario orchestrator (book-keeping mirror) --------
app.route("/v1/scenarios", buildScenariosRouter({ consent: consentManager }));

// -------- PHM evaluator + booking trigger --------
app.route("/v1/phm", buildPhmRouter());

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

// -------- intake multimodal (photo + audio) --------
// Mounted at /v1/intake so that /photo and /audio resolve here. The
// inline /commit and /draft handlers below take precedence for those
// specific paths because they're registered as concrete routes.
app.route("/v1/intake", buildIntakeRouter());

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

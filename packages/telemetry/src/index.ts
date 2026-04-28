// =============================================================================
// @vsbs/telemetry - observability barrel.
// =============================================================================

// Server/browser provider initialisation must be imported from the
// matching subpath:
//   import { initOtelServer } from "@vsbs/telemetry/otel-server";
//   import { initOtelBrowser } from "@vsbs/telemetry/otel-browser";
// The barrel exposes only the types + runtime-agnostic helpers so it can
// be imported from any environment without dragging in Node-only or
// browser-only dependencies.
export {
  withSpan,
  activeTraceIds,
  type OtelInitOptions,
  type OtelHandle,
} from "./otel.js";

export {
  makeLogger,
  makeVsbsLogger,
  VsbsLogger,
  callerFrame,
  hashUser,
  scrubString,
  type LoggerOptions,
  type LogContext,
} from "./logger.js";

export {
  initMetrics,
  renderProm,
  collectInMemoryProm,
  HTTP_DURATION_BUCKETS,
  type MetricsInitOptions,
  type MetricsHandle,
  type VsbsMeters,
  type PromExposition,
} from "./metrics.js";

export {
  HealthChecker,
  makeAlloyDbPing,
  makeFirestorePing,
  makeSecretManagerList,
  makeLlmProviderPing,
  type CheckStatus,
  type CheckResult,
  type HealthReport,
  type CheckFn,
  type HealthCheckerOptions,
} from "./health.js";

export {
  defineSlo,
  evaluate,
  STANDARD_THRESHOLDS,
  VSBS_SLOS,
  type SloWindow,
  type SloDefinition,
  type SliDefinition,
  type Observation,
  type SloEvaluation,
  type BurnRateThreshold,
} from "./slo.js";

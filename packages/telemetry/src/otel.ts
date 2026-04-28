// =============================================================================
// Runtime-agnostic re-export. Server and browser-specific provider
// initialisation lives in otel-server.ts and otel-browser.ts respectively;
// importing one of those subpaths is required to actually initialise OTel.
// This file exposes only the types + helpers safe for any runtime so the
// package barrel can be imported from anywhere without dragging in
// async_hooks (Node) or DOM-only globals (browser).
// =============================================================================

export {
  activeTraceIds,
  withSpan,
  type OtelHandle,
  type OtelInitOptions,
} from "./otel-shared.js";

// =============================================================================
// Telemetry-aware request logger. Replaces the older `structuredLogger` from
// security.ts when @vsbs/telemetry is wired up - both can run side-by-side
// during the migration. Emits one structured line per response with:
//   req_id, method, route, status, duration_ms, region, user_hash
// plus the active OTel trace+span ids.
// =============================================================================

import type { MiddlewareHandler } from "hono";
import { hashUser, activeTraceIds, type VsbsLogger } from "@vsbs/telemetry";
import type { AppEnv } from "./security.js";

export interface LogMiddlewareOptions {
  log: VsbsLogger;
  region: string;
  /** Per-process salt used to hash user identifiers before logging. */
  userHashSalt: string;
  /** Optional sink that mirrors every emitted entry to a SIEM ring buffer. */
  sink?: (entry: {
    level: "info" | "warn" | "error";
    msg: string;
    fields: Record<string, unknown>;
    trace_id?: string;
    span_id?: string;
  }) => void;
}

export function telemetryLogger(opts: LogMiddlewareOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = Date.now();
    const rid = c.get("requestId");
    let userHash: string | undefined;
    const userHeader = c.req.header("x-user-id") ?? c.req.header("authorization");
    if (userHeader) userHash = await hashUser(userHeader, opts.userHashSalt);
    await next();
    const status = c.res.status;
    const durationMs = Date.now() - started;
    const route = (c as unknown as { routePath?: string }).routePath ?? c.req.path;
    const fields: Record<string, unknown> = {
      request_id: rid,
      method: c.req.method,
      route,
      status,
      duration_ms: durationMs,
      region: opts.region,
    };
    if (userHash) fields.user_hash = userHash;
    const level: "info" | "warn" | "error" =
      status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    opts.log[level]("http.request", fields);
    if (opts.sink) {
      const ids = activeTraceIds();
      opts.sink({
        level,
        msg: "http.request",
        fields,
        ...(ids.traceId ? { trace_id: ids.traceId } : {}),
        ...(ids.spanId ? { span_id: ids.spanId } : {}),
      });
    }
  };
}

// =============================================================================
// OpenTelemetry middleware. Wraps every Hono request in an active span and
// stamps SemConv-aligned attributes (route, method, status, region, tenant,
// user_hash). Exceptions are recorded on the span; status code is mapped to
// the OTel canonical code per the HTTP semantic conventions.
// =============================================================================

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./security.js";

// Span shape we care about. Avoids a direct dep on @opentelemetry/api in
// every consuming package; @vsbs/telemetry hands us a Tracer that conforms.
export interface SpanLike {
  setAttribute: (k: string, v: string | number | boolean) => void;
  setStatus: (s: { code: number; message?: string }) => void;
  recordException: (e: unknown) => void;
  end: () => void;
}
export interface TracerLike {
  startActiveSpan: <T>(
    name: string,
    options: {
      kind?: number;
      attributes?: Record<string, string | number | boolean>;
    },
    fn: (span: SpanLike) => Promise<T>,
  ) => Promise<T>;
}

const SPAN_KIND_SERVER = 1; // OTel semconv
const STATUS_OK = 1;
const STATUS_ERROR = 2;

export interface OtelMiddlewareOptions {
  tracer: TracerLike;
  region: string;
  serviceName: string;
}

export function otel(opts: OtelMiddlewareOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const route = (c as unknown as { routePath?: string }).routePath ?? c.req.path;
    const spanName = `${c.req.method} ${route}`;
    await opts.tracer.startActiveSpan(
      spanName,
      {
        kind: SPAN_KIND_SERVER,
        attributes: {
          "http.request.method": c.req.method,
          "http.route": route,
          "url.path": c.req.path,
          "service.name": opts.serviceName,
          "service.region": opts.region,
        },
      },
      async (span) => {
        const rid = c.get("requestId");
        if (rid) span.setAttribute("vsbs.request_id", rid);
        try {
          await next();
          const status = c.res.status;
          span.setAttribute("http.response.status_code", status);
          span.setStatus({ code: status >= 500 ? STATUS_ERROR : STATUS_OK });
        } catch (err) {
          span.recordException(err);
          span.setStatus({ code: STATUS_ERROR, message: String(err) });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  };
}

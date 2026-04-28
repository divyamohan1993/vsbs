# VSBS observability surface

This document is the operator's entry point to the production telemetry
surface. The implementation lives in `packages/telemetry`, the wiring lives
in `apps/api/src/middleware/{otel,log}.ts` and `apps/api/src/server.ts`, the
infra lives in `infra/terraform/observability.tf`, and the operator-facing
dashboard lives in `apps/admin`.

## Stack at a glance

```
Browser                      API (Bun on Cloud Run)             Backends
────────                     ─────────────────────              ───────────────
Web Vitals (PerfObserver) -> /metrics web-vitals route -> Cloud Logging metric
                              │
                              ├── OpenTelemetry SDK (BasicTracerProvider)
                              │      └── BatchSpanProcessor -> OTLP HTTP -> Cloud Trace
                              │
                              ├── pino structured logger -> stdout NDJSON -> Cloud Logging
                              │      └── PII redact, OTel context, file:line:fn
                              │
                              ├── OpenTelemetry SDK (MeterProvider)
                              │      └── PeriodicExportingMetricReader
                              │             ├── OTLPMetricExporter -> Cloud Monitoring
                              │             └── /metrics endpoint -> Prometheus scrape
                              │
                              └── HealthChecker registry
                                     ├── /healthz (liveness)
                                     ├── /readyz (aggregated)
                                     └── /healthz/details (admin-gated)
```

## Spec references

- OpenTelemetry Specification 1.36 - semantic conventions, trace context.
- W3C Trace Context Level 2 - `traceparent` / `tracestate` headers.
- Google SRE workbook (Chapter 5) - multi-window burn-rate alerting.
- Google Cloud Trace OTLP ingest - `otlp.googleapis.com` (no agent needed).
- OWASP ASVS L2 §10 - logging and monitoring requirements.
- DPDP Rules 2025 §6 - log retention and breach notification triggers.

## Spans

Every API request opens a `SERVER` span named `<METHOD> <route>` with
attributes:

| Attribute                         | Notes                                    |
|-----------------------------------|------------------------------------------|
| `http.request.method`             | GET / POST / etc.                        |
| `http.route`                      | Hono `routePath`, not the full URL.      |
| `http.response.status_code`       | Set after `next()`.                      |
| `service.name` / `service.region` | From the Resource block.                 |
| `vsbs.request_id`                 | Same id surfaced as `X-Request-Id`.      |

Exceptions are recorded on the span (`recordException`) and the span status
is set to `ERROR` for any 5xx response or thrown exception.

## Logs

Every log line is JSON on stdout with the following keys (Cloud Logging
ingests these directly):

```
ts, level, severity, msg, service, region, env, file, line, fn,
trace_id, span_id, request_id, tenant?, user_hash?, fields?
```

PII is redacted at two layers:

1. **pino redact paths** - drop sensitive keys whole (`password`, `token`,
   `phone`, `email`, `aadhaar`, `creditCard`, etc.).
2. **`scrubString` helper** - best-effort regex scrub of free-form strings for
   phone numbers, emails, VINs, Aadhaar numbers, and 16-digit card patterns.

## Metrics

| Metric                                            | Type      | Notes                                       |
|---------------------------------------------------|-----------|---------------------------------------------|
| `vsbs_http_requests_total`                        | counter   | by method, route, status                    |
| `vsbs_http_request_duration_seconds`              | histogram | Prom-standard buckets up to 30 s            |
| `vsbs_safety_overrides_total`                     | counter   | Source of truth for the page                |
| `vsbs_dispatch_mode_total`                        | counter   | by mode (drive-in/mobile/pickup/tow)        |
| `vsbs_consent_changes_total`                      | counter   | by purpose, action                          |
| `vsbs_wellbeing_score`                            | histogram | distribution per booking                    |
| `vsbs_active_bookings`                            | gauge     | non-terminal-state count                    |
| `vsbs_pending_grants`                             | gauge     | grants minted but not settled               |

## SLOs

Defined in `packages/telemetry/src/slo.ts`:

| Name                       | Target | Window |
|----------------------------|--------|--------|
| `api-availability`         | 99.9 % | 30 d   |
| `api-latency-p99`          | 99 %   | 7 d    |
| `concierge-turn-success`   | 99.5 % | 7 d    |
| `autonomy-handoff-success` | 99.9 % | 30 d   |

Multi-window burn-rate thresholds (Google SRE workbook):

| Name      | Window | Multiplier | Severity |
|-----------|--------|------------|----------|
| fast-burn | 1 h    | 14.4×      | page     |
| slow-burn | 6 h    | 6×         | page     |
| ticket    | 3 d    | 1×         | ticket   |

## Health surface

| Endpoint            | Purpose                                 | Auth        |
|---------------------|-----------------------------------------|-------------|
| `/healthz`          | Liveness - process check only.          | Public      |
| `/readyz`           | Aggregated dependency status.           | Public      |
| `/healthz/details`  | Per-check breakdown.                    | Admin-only  |

Built-in checks: `alloydb-ping`, `firestore-ping`, `secret-manager-list`,
`llm-provider-ping`. Each has a sim driver (always healthy with jitter) and
a live driver that calls the dependency. Check results are cached for 5 s.

## SIEM admin pane

`apps/admin` (port 3001) exposes a SIEM-shaped dashboard at `/dashboard`:

- `/admin/logs` - live SSE feed from `/v1/admin/logs/stream`, filterable
  by level and substring.
- `/admin/alerts` - table of canonical SLOs and burn-rate thresholds.
- `/admin/runbooks` - links to the operator playbooks under `docs/runbooks/`.
- `/admin/canary` - read-only flag table, auto-rollback policy.

Access is gated by Cloud IAP (live) or a signed dev token (`ADMIN_AUTH_MODE=sim`).

## Runbooks

- `docs/runbooks/high-error-rate.md`
- `docs/runbooks/high-latency.md`
- `docs/runbooks/safety-override-spike.md`
- `docs/runbooks/autonomy-handoff-failure.md`
- `docs/runbooks/canary-rollback.md`

Each follows: detect → assess → contain → fix → post-mortem.

## Configuration

| Variable                            | Notes                                                       |
|-------------------------------------|-------------------------------------------------------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT`       | OTLP collector base URL. Absent ⇒ in-memory fallback.       |
| `NEXT_PUBLIC_OTLP_BROWSER_URL`      | Optional browser-side OTLP endpoint for trace push.         |
| `LOG_LEVEL`                         | trace / debug / info / warn / error.                        |
| `IDENTITY_PLATFORM_SIGNING_KEY`     | Salt for the `user_hash` field in request logs.             |
| `APP_REGION`                        | Stamped on every span, log, and metric resource.            |

## Author

Divya Mohan (dmj.one, contact@dmj.one). Apache 2.0 + NOTICE.

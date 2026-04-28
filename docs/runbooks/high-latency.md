# Runbook - high latency

**Alert:** `VSBS API p99 latency > 1 s (10 min)` from
`infra/terraform/observability.tf::api_latency_p99`.
**Page severity:** P2 (P1 if it coincides with an error-rate page).

## 1. Detect

The alert fires when the p99 of `run.googleapis.com/request_latencies` exceeds
1 s for 10 consecutive minutes on any region. The
`vsbs_http_request_duration_seconds` histogram on `/metrics` confirms the same
view from the application's own measurements.

## 2. Assess

1. Group p99 by `route` on the dashboard. Concierge SSE turns are expected to
   sit in the long tail; everything else should be sub-second.
2. Pull the slow trace ids from Cloud Trace and check whether the latency is
   spent in a tool call, an LLM completion, or a downstream dependency.
3. Inspect the `vsbs_concierge_turns_total` counter - a spike often indicates
   model-routing escalation to a slower-but-better provider.
4. Check `/healthz/details` for AlloyDB or LLM provider degradation.

## 3. Contain

- If the LLM provider is degraded, switch profiles via the
  `LLM_PROFILE` env on the Cloud Run revision so the supervisor falls back to a
  faster model. Promote with a fresh canary.
- If AlloyDB latency is the cause, lower `kb.alloydb_pgvector` flag to `sim`
  on the canary console - the deterministic shards will mask the latency for
  read paths until the database recovers.

## 4. Fix

- Add a span around the offending span name and re-deploy with a regression
  benchmark in the package's test suite.

## 5. Post-mortem

- File the post-mortem and update the SLO error budget burn-down sheet.

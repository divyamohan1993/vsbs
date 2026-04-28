# Runbook - high error rate

**Alert:** `VSBS API error rate > 1 % (5 min)` from `infra/terraform/observability.tf::api_error_rate`.
**Page severity:** P1.
**Owner:** API on-call.

## 1. Detect

The alert fires when 5xx responses exceed 1 % of total requests over a rolling
five-minute window per Cloud Run revision. The `vsbs_http_requests_total{status=~"5.."}`
counter on the SIEM admin pane should also turn red.

## 2. Assess

1. Open the **Logs** pane in the admin console (`/admin/logs`) and filter by `level=error`.
2. Group the recent error volume by `route` to see whether the regression is
   route-scoped or global.
3. Check `/healthz/details` (admin-gated) for any dependency that has flipped to
   `unhealthy` or `degraded`.
4. Inspect the top trace ids on the error log lines and pull them from Cloud
   Trace via the linked `trace_id`.

## 3. Contain

- If the error is route-scoped and the route is non-critical, set the
  corresponding kill-switch flag in the canary console (`/admin/canary`) to
  `off` and confirm traffic is no longer hitting that route in the dashboard.
- If the error correlates with a recent canary, demote the canary to 0 % using
  the runbook in `docs/runbooks/canary-rollback.md`.

## 4. Fix

- Reproduce locally with the captured payload. Add a regression test under the
  affected package's test suite.
- Deploy the fix as a *new* canary at 5 %. Watch the alert for one full burn
  window before promoting.

## 5. Post-mortem

- Open a blameless post-mortem within 48 hours. Use the template in
  `docs/compliance/incident-template.md`.
- Add a new line to the AI / incident risk register if the root cause is
  generative or autonomy-related.

# Runbook - canary rollback

**Trigger:** Any P1 page that correlates with a recently promoted canary.
**Goal:** Restore the prior revision and stop the bleed in under 60 seconds.

## 1. Detect

A canary rollback is reactive - the trigger is one of the other runbooks
detecting a regression that started after a canary promotion. Confirm in the
release log on `/admin/canary` that a promotion happened in the last hour.

## 2. Decide

- If the regression is contained to a single agent or adapter, prefer flipping
  that flag to `off` rather than rolling back the whole revision.
- Otherwise: full revision rollback.

## 3. Roll back

```
gcloud run services update-traffic vsbs-api \
  --region=asia-south1 \
  --to-revisions=$PRIOR_REVISION=100
```

The CLI write is atomic. The new traffic split takes effect within five
seconds; existing in-flight requests finish on the previous revision.

Repeat for each region.

## 4. Confirm

- Watch `vsbs_http_requests_total{status=~"5.."}` on the dashboard. Within one
  minute of the rollback the rate should fall back below the pre-canary
  baseline.
- Re-evaluate the firing alert; it should clear within its burn window.

## 5. Post-rollback

- Mark the rolled-back revision as `do-not-promote` in Artifact Registry.
- File the post-mortem before re-attempting the change. The fix lands as a new
  canary at 5 % only after a green soak.

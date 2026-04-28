# Runbook - safety override spike

**Alert:** `VSBS safety overrides above baseline` (logging metric
`vsbs/safety_overrides`).
**Page severity:** P1. Always paged regardless of time of day.

Safety overrides are the system saying "the hard-coded floor disagreed with the
operator and the operator chose to proceed". A spike means either an
overzealous safety floor in production or, worse, an operator pattern that
short-circuits the safety check. Both must be investigated immediately.

## 1. Detect

The alert fires the moment a safety override is recorded. The
`vsbs_safety_overrides_total` counter is the source of truth.

## 2. Assess

1. Open `/admin/safety-overrides` for the per-incident detail (operator,
   booking id, red-flag set, override reason).
2. Pull each override's trace from Cloud Trace via `trace_id` and verify the
   booking's red-flag set against the live safety logic in
   `packages/shared/src/safety.ts`.
3. Cross-reference the operator's recent decisions to see whether this is one
   anomalous booking or a pattern.

## 3. Contain

- If a single operator is responsible and the pattern is suspicious, demote
  their role in Identity Platform pending review.
- If a code path triggered a false positive that operators are systematically
  overriding, set the relevant safety canary to 0 % and re-run the safety
  regression suite locally.

## 4. Fix

- Add the offending case to the safety regression corpus in
  `packages/shared/src/safety.test.ts` so the issue cannot regress silently.
- Patch the safety logic if a real bug; otherwise add operator training notes.

## 5. Post-mortem

- Mandatory blameless post-mortem within 24 hours; involves DPO and the
  responsible engineering lead.
- Update the AI risk register row covering "operator-initiated safety bypass".

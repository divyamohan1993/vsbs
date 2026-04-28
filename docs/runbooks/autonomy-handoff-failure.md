# Runbook - autonomy handoff failure

**Alert:** `VSBS autonomy handoff failure rate > 0.1 %` (logging metric
`vsbs/autonomy_handoff_failures`).
**Page severity:** P1. Autonomy handoffs touch a moving vehicle.

## 1. Detect

The alert fires when the rate of failed `acceptGrant` / `revokeGrant` calls
exceeds 0.1 % over a five-minute window. The `vsbs_pending_grants` gauge
will also climb above its baseline if grants are being minted but not settled.

## 2. Assess

1. Open `/admin/audit` and check the most recent command-grant entries for
   verifier failures.
2. Filter the live logs by `msg=autonomy_handoff_failed` and read the OEM
   adapter responses.
3. Hit `/healthz/details` and confirm the LLM and OEM adapter probes are
   passing - the safety gate runs through both paths.
4. Pull the trace for the most recent failure and inspect the takeover ladder
   timing (target: T_R for the relevant rung per UNECE R157).

## 3. Contain

- Activate the `kill_switch.autonomy` flag in `/admin/canary`. This stops
  minting new grants and revokes outstanding ones via the lifecycle endpoint.
- Verify on the dashboard that `vsbs_pending_grants` drops to zero within
  60 seconds.

## 4. Fix

- Add the failing payload as a regression test in
  `packages/shared/src/commandgrant-lifecycle.test.ts`.
- For OEM-side failures, escalate to the OEM partner contact listed in the
  vendor matrix and freeze the associated adapter behind its kill switch.

## 5. Post-mortem

- Mandatory blameless post-mortem with the safety lead and DPO.
- File a defensive-publication amendment if the root cause exposes a new
  inventive aspect of the handoff lifecycle.

# Validation Report

## Validation Rubric

For each candidate, I checked:

- [x] Attacker-controlled input is identified.
- [x] Entry point is reachable through an app route or deployment workflow.
- [x] Closest control/guard is identified.
- [x] Sink/impact is concrete.
- [x] Runtime reproduction is attempted when feasible and proportionate.

## Runtime Reproduction

PoC file: `/tmp/codex-security-scans/vehicle-service-booking-system/ad39041_20260509T021309Z/artifacts/pocs/runtime-probes.ts`

Command:

```bash
bun run /tmp/codex-security-scans/vehicle-service-booking-system/ad39041_20260509T021309Z/artifacts/pocs/runtime-probes.ts
```

Latest observed results:

- `forged admin header -> /v1/admin/bookings 200`
- `spoofed x-vsbs-owner -> /v1/me/data-export 200 true`
- `unauth payment order create 201`
- `sim-signed autonomy grant 201`
- `unauth sensor poison/read 202 200 true` after public consent bootstrap
- `public concierge thread read 200 true`

## Closure Table

| Row | Candidate | Root control | Entrypoint/source | Sink/control | Disposition | Counterevidence/proof gap | Survives |
|---|---|---|---|---|---|---|---|
| V1 | Forged admin JWT | `apps/api/src/middleware/admin.ts:56` | `x-goog-iap-jwt-assertion` header | `adminOnly` accepts decoded role | reportable | Would be mitigated by correctly attached IAP and fail-closed ingress, but Terraform/code do not prove that and runtime route accepted forged header. | yes |
| V2 | Owner spoofing/no session | `apps/api/src/routes/me.ts:47` | `x-vsbs-owner` header | owner-scoped consent/export/erasure | reportable | Intended "Phase 6" future auth is documented but not implemented. | yes |
| V3 | Payment authz missing | `apps/api/src/routes/payment.ts:48` | unauth POST `/v1/payments/orders` | order/payment state creation | reportable | Consent gate exists later in `server.ts`, but runtime creation returned 201. | yes |
| V4 | Autonomy grant unauth/sim verifier | `apps/api/src/routes/autonomy.ts:99` | POST `/v1/autonomy/grant/sign` | sim verifier accepts deterministic signature | reportable | Requires `AUTONOMY_ENABLED=true`; roadmap says this should happen only after go-live gates. If toggled early, exploit is direct. | yes |
| V5 | Concierge thread leak | `apps/api/src/routes/concierge.ts:132` | GET `/v1/concierge/threads/:id` | returns stored messages | reportable | Thread ids may be hard to guess in some clients, but caller controls ids and runtime PoC leaked seeded PII. | yes |
| V6 | Sensor/telemetry poisoning | `apps/api/src/routes/sensors.ts:65` | public consent bootstrap + sensor ingest/latest | latest state and dashboard streams | reportable | Raw `/v1/sensors/ingest` returned 409 without consent, but public bootstrap route seeds consent for arbitrary `userId`, then ingest returned 202. | yes |
| V7 | Recording subprocess trigger/read | `apps/api/src/routes/recordings.ts:51` | POST `/v1/recordings/start` | `Bun.spawn(["bash", script])` | reportable | I did not run this PoC to avoid launching a long recording subprocess; static source/control/sink is sufficient. | yes |
| V8 | Cloud Armor/IAP not attached | `infra/terraform/modules/region/main.tf:348` | GCP external LB/backend config | no `security_policy`/IAP config | reportable | Could be added out-of-band, but repository Terraform is the prod wiring source and app middleware defaults fail-open. | yes |
| V9 | Prod env/deploy wiring gaps | `infra/terraform/modules/region/main.tf:165` | Cloud Run env, Next proxy, CI deploy | sim defaults, localhost proxy, missing deploy file | reportable | Operators could manually set missing env vars, but repo automation does not. | yes |
| V10 | Dependency advisories | `pnpm-lock.yaml` | mobile/expo transitive deps | known vulnerable packages | reportable-medium | No direct product exploit path confirmed; treat as dependency hygiene. | yes |

## Validation Notes

- Runtime reproduction uses the real app object from `apps/api/src/server.ts`, not a reimplementation.
- The app was exercised with `NODE_ENV=production` and explicit sim/live toggles where the code permits them.
- I did not start the dev server or Cloud Run; deployment findings are static Terraform/CI validation findings.
- `pnpm` was not installed directly in the shell. Running the declared package manager with `bun x pnpm@9.12.3` worked and produced audit results.

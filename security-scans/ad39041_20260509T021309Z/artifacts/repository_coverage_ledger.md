# Repository Coverage Ledger

| Row | Area | Files sampled | Result |
|---|---|---|---|
| L1 | API route inventory | `apps/api/src/server.ts`, `apps/api/src/routes/*` | Reportable authn/authz gaps across admin, owner, payment, autonomy, concierge, sensors, recordings. |
| L2 | Admin gate | `apps/api/src/middleware/admin.ts`, `apps/admin/src/proxy.ts`, `apps/api/src/routes/admin/router.ts` | Reportable forged JWT/header trust bug. |
| L3 | User auth/session | `apps/api/src/routes/auth.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/middleware/consent-gate.ts`, `apps/mobile/src/lib/api.ts`, `apps/mobile/app/(auth)/login.tsx` | Reportable missing durable session and owner spoofing. |
| L4 | Payments | `apps/api/src/routes/payment.ts`, `apps/api/src/server.ts`, `packages/shared/src/payment.ts` | Reportable unauth order/intents/capture/refund surface. |
| L5 | Autonomy command grants | `apps/api/src/routes/autonomy.ts`, `apps/api/src/server.ts`, `packages/shared/src/autonomy.ts`, `packages/shared/src/commandgrant-lifecycle.ts` | Reportable unauth grant lifecycle and sim verifier in production-mode repro. |
| L6 | Sensor/telemetry | `apps/api/src/routes/sensors.ts`, `apps/api/src/routes/autonomy.ts`, `packages/shared/src/sensors.ts`, `tools/carla/vsbs_carla/api.py` | Reportable unauth consent seed, ingest/read, dashboard event poisoning. |
| L7 | Concierge/LLM | `apps/api/src/routes/concierge.ts`, `apps/api/src/routes/llm.ts`, `packages/agents/src/*`, `packages/llm/src/*` | Reportable public thread read; lower-risk public diagnostics/cost surface. |
| L8 | Recordings/files/process | `apps/api/src/routes/recordings.ts`, `apps/api/src/adapters/recordings/orchestrator.ts`, `tools/carla/scripts/*` | Reportable unauth expensive subprocess trigger and public recording index/files. |
| L9 | Region/data residency | `apps/api/src/routes/region.ts`, `apps/api/src/middleware/region*.ts`, Terraform region modules | Reportable as part of owner spoofing/prod wiring; no separate higher-severity issue proven. |
| L10 | Infra edge | `infra/terraform/global/main.tf`, `infra/terraform/modules/region/main.tf`, `infra/terraform/security.tf`, `infra/terraform/main.tf` | Reportable Cloud Armor/IAP attachment gap and incomplete env wiring. |
| L11 | CI/CD | `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `.github/workflows/release.yml` | Reportable deploy job points to missing `deploy/cloudbuild.yaml`; supply-chain controls incomplete. |
| L12 | Secrets | `.env.example`, `.gitignore`, local `.env` | No tracked live secret found; local untracked `.env` contains a provider key name and should be handled as local secret material. |
| L13 | Dependency audit | `pnpm-lock.yaml`, `package.json`, `apps/mobile/package.json` | High advisories found in mobile transitive dependencies; no direct exploit path confirmed. |
| L14 | Tests/docs | `apps/api/src/**/*.test.ts`, docs under `docs/` | Tests exercise current insecure assumptions in places; docs themselves acknowledge production hardening remains future work. |

## Exhaustive Checklist

The repository has 747 tracked files. I did not line-review every generated/static UI asset in detail. I did inventory all security-relevant runtime surfaces, Terraform edge/deploy wiring, workflow files, auth/session paths, and high-impact domain routes.

Primary files inspected are represented in rows L1-L14 and in the exact file references in `finding_discovery_report.md`, `validation_report.md`, and `attack_path_analysis.md`.

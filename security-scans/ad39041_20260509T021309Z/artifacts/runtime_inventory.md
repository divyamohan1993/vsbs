# Runtime Inventory

Scan target: `/mnt/experiments/vehicle-service-booking-system`
Commit: `ad39041132063a4dbcc773b9eb9c14de4e4775fb`
Scan id: `ad39041_20260509T021309Z`
Date: `2026-05-09`

## Product Surfaces

- `apps/api`: Bun/Hono API mounted as `/v1/*`, with auth, payments, concierge, sensors, autonomy, recordings, admin, region, dispatch, intake, PHM, KB, health, metrics.
- `apps/web`: Next.js user web app. Browser calls are mostly proxied through `/api/proxy/[...path]`.
- `apps/admin`: Next.js admin console with proxy and edge/admin middleware.
- `apps/mobile`: Expo mobile app with OTP/passkey flows and bearer-token forwarding.
- `packages/shared`, `packages/security`, `packages/sensors`, `packages/agents`, `packages/llm`, `packages/compliance`: shared contracts and domain logic.
- `infra/terraform`: GCP Cloud Run, load balancer, Cloud Armor, region router, secrets, logging, security baseline.
- `tools/carla`: CARLA demo bridge, telemetry pushers, and recording/orchestrator support.

## Security-Critical Trust Boundaries

- External user/browser/mobile -> API routes in `apps/api/src/server.ts`.
- Web/admin Next proxy -> API base through `VSBS_API_BASE`.
- Admin trust boundary -> `x-goog-iap-jwt-assertion` or dev-token header.
- Owner identity boundary -> intended auth session, but currently `x-vsbs-owner` or request body in multiple routes.
- Consent gate -> `requireConsent`, currently based on caller-controlled owner headers.
- Payment state machine -> public payment HTTP routes.
- Autonomy grant and telemetry -> public HTTP routes plus sim/live toggles.
- Sensor and recording routes -> public HTTP routes that affect telemetry state or start subprocesses.
- GCP edge -> Cloud Armor/IAP assumptions versus Terraform attachment.

## Production Assumptions From Docs/Code

- The threat model marks CommandGrant, PII, auto-pay, telemetry, OEM tokens, and admin SIEM as high/critical assets (`docs/security/threat-model.md:18`, `docs/security/threat-model.md:23`, `docs/security/threat-model.md:26`).
- The roadmap places real global auth, Identity Platform, IAP/BeyondCorp, Cloud Armor, Binary Authorization, and passkeys in hardening/go-live phases (`docs/roadmap-prod-deploy.md:48`, `docs/roadmap-prod-deploy.md:68`, `docs/roadmap-prod-deploy.md:130`).
- README explicitly says the repo is research-grade and not production/certified safety software (`README.md:1`).

## Runtime Probe

Repro script:

`/tmp/codex-security-scans/vehicle-service-booking-system/ad39041_20260509T021309Z/artifacts/pocs/runtime-probes.ts`

Command:

```bash
bun run /tmp/codex-security-scans/vehicle-service-booking-system/ad39041_20260509T021309Z/artifacts/pocs/runtime-probes.ts
```

Observed:

- forged admin header -> `/v1/admin/bookings`: `200`
- spoofed `x-vsbs-owner` -> `/v1/me/data-export`: `200`, body contained attacker-chosen owner id
- unauth payment order create: `201`
- sim-signed autonomy grant: `201`
- unauth consent bootstrap + sensor ingest/read: `201`, `202`, `200`, latest contained injected coordinate
- public concierge thread read: `200`, body contained seeded phone substring

## Dependency Audit

Command attempted with declared package manager:

```bash
bun x pnpm@9.12.3 audit --prod --audit-level high
```

Observed: `17 vulnerabilities found`, including `7 high`:

- `@xmldom/xmldom@0.7.13` via Expo config/plist: GHSA-wh4c-j3r5-mjhp, GHSA-2v35-w6hq-6mfw, GHSA-f6ww-3ggp-fr8h, GHSA-x6wf-f3px-wcqx, GHSA-j759-j44w-7fr8.
- `fast-uri@3.1.0` via `schema-utils > ajv`: GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc.

These are dependency hygiene findings. I did not find a direct app route that turns them into a higher-severity exploit during this pass.

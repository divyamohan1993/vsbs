# Finding Discovery Report

## F1 - Forged IAP/admin JWT accepted

Severity candidate: Critical

Evidence:

- API admin verifier decodes JWT payload and checks `role`/`roles` plus `exp`, but never validates signature, issuer, audience, or that IAP actually generated the assertion: `apps/api/src/middleware/admin.ts:56`, `apps/api/src/middleware/admin.ts:78`.
- Admin Next proxy repeats the same trust pattern despite comments saying live mode verifies IAP signature: `apps/admin/src/proxy.ts:71`, `apps/admin/src/proxy.ts:108`.
- Admin router mounts protected routes behind `adminOnly`: `apps/api/src/routes/admin/router.ts:155`.

Candidate impact: attacker who can reach the API/admin surface and supply `x-goog-iap-jwt-assertion` can forge `role: admin` and access/write admin functions.

## F2 - No real user session; owner identity is caller-controlled

Severity candidate: Critical

Evidence:

- OTP verify returns `subject` only and does not mint a server-verifiable session/JWT/cookie: `apps/api/src/routes/auth.ts:61`.
- Owner identity for `/v1/me` is `x-vsbs-owner` or `demo-owner`: `apps/api/src/routes/me.ts:47`, used for consent, erasure, and data export at `apps/api/src/routes/me.ts:52`, `apps/api/src/routes/me.ts:174`, `apps/api/src/routes/me.ts:208`.
- Consent gate uses the same caller-controlled header: `apps/api/src/middleware/consent-gate.ts:28`.
- Region switching accepts explicit `ownerId` or `x-vsbs-owner`: `apps/api/src/routes/region.ts:56`, `apps/api/src/routes/region.ts:67`, `apps/api/src/routes/region.ts:93`.
- Mobile comments confirm the token is currently a placeholder subject: `apps/mobile/app/(auth)/login.tsx:71`.

Candidate impact: IDOR/tenant-boundary break for all owner-scoped data and consent gates.

## F3 - Payment state machine exposed without authz

Severity candidate: Critical/High

Evidence:

- `/orders`, `/orders/:orderId/intents`, `/intents/:intentId/authorise`, `/orders/:orderId/capture`, and `/orders/:orderId/refund` have no auth or ownership check: `apps/api/src/routes/payment.ts:48`, `apps/api/src/routes/payment.ts:66`, `apps/api/src/routes/payment.ts:83`, `apps/api/src/routes/payment.ts:93`, `apps/api/src/routes/payment.ts:99`.
- Payment router is mounted before the consent gate: `apps/api/src/server.ts:351`; consent gate appears later at `apps/api/src/server.ts:387`.

Candidate impact: unauthenticated creation/manipulation of orders, captures, refunds, and payment intents.

## F4 - Autonomy grant lifecycle can be driven by unauthenticated callers

Severity candidate: Critical

Evidence:

- Autonomy verifier selects sim verifier whenever `MERCEDES_IPP_MODE !== "live"`: `apps/api/src/routes/autonomy.ts:99`.
- Sim signatures are deterministic hashes available in shared code: `packages/shared/src/commandgrant-lifecycle.ts:183`, `packages/shared/src/commandgrant-lifecycle.ts:274`.
- `/grant/challenge`, `/grant/sign`, action/revoke/perform, heartbeat, and offline envelope routes do not authenticate an owner or grantee principal: `apps/api/src/routes/autonomy.ts:174`, `apps/api/src/routes/autonomy.ts:195`, `apps/api/src/routes/autonomy.ts:215`, `apps/api/src/routes/autonomy.ts:239`, `apps/api/src/routes/autonomy.ts:263`, `apps/api/src/routes/autonomy.ts:348`, `apps/api/src/routes/autonomy.ts:399`.
- Comment says heartbeat requires `x-tick-token`/mTLS, but code does not check it: `apps/api/src/routes/autonomy.ts:335`.
- Inline `/v1/autonomy/grant` accepts `CommandGrantSchema` and logs acceptance without signature verification: `apps/api/src/server.ts:524`.

Candidate impact: unauthorized minting, operation, revocation, offline envelope minting, and telemetry/control-plane poisoning around vehicle autonomy.

## F5 - Concierge thread history is public by guessable caller-controlled id

Severity candidate: High

Evidence:

- Caller supplies `conversationId`; the route appends user/assistant messages to in-memory store: `apps/api/src/routes/concierge.ts:85`, `apps/api/src/routes/concierge.ts:126`.
- `GET /threads/:id` returns messages for any id with no auth or ownership check: `apps/api/src/routes/concierge.ts:132`.

Candidate impact: PII leakage from conversation history.

## F6 - Sensor and live telemetry surfaces are unauthenticated/spoofable

Severity candidate: High

Evidence:

- Sensor ingest and latest/session routes lack producer/user auth in the router: `apps/api/src/routes/sensors.ts:65`, `apps/api/src/routes/sensors.ts:99`, `apps/api/src/routes/sensors.ts:110`, `apps/api/src/routes/sensors.ts:147`, `apps/api/src/routes/sensors.ts:176`.
- The only sensor consent gate is for `/v1/sensors/ingest`, based on spoofable owner identity and bypassable by public bootstrap: `apps/api/src/server.ts:391`, `apps/api/src/routes/scenarios.ts:196`.
- Autonomy live telemetry/event ingest routes are intentionally not guarded by `AUTONOMY_ENABLED` and do not authenticate a producer: `apps/api/src/routes/autonomy.ts:521`, `apps/api/src/routes/autonomy.ts:572`, `apps/api/src/routes/autonomy.ts:584`.

Candidate impact: attacker can poison or read telemetry and dashboard state for arbitrary vehicle/booking ids.

## F7 - Recordings API lets anonymous callers start expensive subprocesses and enumerate/read outputs

Severity candidate: High/Medium

Evidence:

- `POST /v1/recordings/start` calls `orchestrator.start` with no auth: `apps/api/src/routes/recordings.ts:51`.
- Index/detail/file/poster routes are public: `apps/api/src/routes/recordings.ts:80`, `apps/api/src/routes/recordings.ts:85`, `apps/api/src/routes/recordings.ts:195`, `apps/api/src/routes/recordings.ts:213`.
- Orchestrator spawns `bash` with the recording script and a hard timeout of `duration + 120s`: `apps/api/src/adapters/recordings/orchestrator.ts:153`, `apps/api/src/adapters/recordings/orchestrator.ts:166`, `apps/api/src/adapters/recordings/orchestrator.ts:194`.

Candidate impact: unauthenticated resource exhaustion and public demo recording disclosure. Not command injection based on reviewed code.

## F8 - Cloud Armor/IAP controls are defined or assumed but not attached/enforced

Severity candidate: High

Evidence:

- Global module creates Cloud Armor policy and explicitly says it must be attached via `security_policy`: `infra/terraform/global/main.tf:141`, `infra/terraform/global/main.tf:419`.
- Region backend services for API/web/router do not set `security_policy`: `infra/terraform/modules/region/main.tf:348`, `infra/terraform/modules/region/main.tf:367`, `infra/terraform/modules/region/main.tf:489`.
- Cloud Armor app middleware defaults fail-open when the verdict header is missing: `apps/api/src/middleware/cloud-armor.ts:30`.
- Terraform comments and variables mention IAP, but code search found no actual `google_iap_*` or backend `iap_config`; URL map only routes `/admin` to backend: `infra/terraform/global/main.tf:295`.

Candidate impact: deployment lacks the edge controls that app code relies on for admin and rate-limit enforcement.

## F9 - Production env/deploy wiring leaves sim/default behavior and broken web->API proxy

Severity candidate: High/Medium

Evidence:

- API defaults are development/sim for `NODE_ENV`, `AUTH_MODE`, `PAYMENT_MODE`, `SMARTCAR_MODE`, `OBD_DONGLE_MODE`, `AUTONOMY_ENABLED`, `AUTONOMY_MODE`, `MERCEDES_IPP_MODE`, and `LLM_PROFILE`: `apps/api/src/env.ts:8`, `apps/api/src/env.ts:48`, `apps/api/src/env.ts:73`, `apps/api/src/env.ts:83`, `apps/api/src/env.ts:87`, `apps/api/src/env.ts:88`, `apps/api/src/env.ts:92`, `apps/api/src/env.ts:103`, `apps/api/src/env.ts:108`.
- Terraform API service injects region/secret vars but not production security mode vars: `infra/terraform/modules/region/main.tf:165`, `infra/terraform/modules/region/main.tf:190`.
- Web/admin proxies use `VSBS_API_BASE` with localhost fallback: `apps/web/src/app/api/proxy/[...path]/route.ts:10`, `apps/admin/src/app/api/proxy/[...path]/route.ts:13`.
- Terraform web service sets `NEXT_PUBLIC_API_BASE`, not `VSBS_API_BASE`: `infra/terraform/modules/region/main.tf:294`.
- CI deploy calls missing `deploy/cloudbuild.yaml`: `.github/workflows/ci.yml:60`.

Candidate impact: production may either fail to connect or run sim/dev defaults if not manually overridden.

## F10 - Dependency advisories in mobile transitive deps

Severity candidate: Medium

Evidence:

- `bun x pnpm@9.12.3 audit --prod --audit-level high` reported 17 vulnerabilities, 7 high, including `@xmldom/xmldom@0.7.13` and `fast-uri@3.1.0` through Expo/mobile tooling paths.

Candidate impact: dependency risk in build/mobile tooling. Direct runtime exploit path was not confirmed.

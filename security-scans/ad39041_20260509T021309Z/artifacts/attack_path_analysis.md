# Attack Path Analysis

## AP1 - Admin Takeover By Forged IAP Assertion

Affected lines:

- root control: `apps/api/src/middleware/admin.ts:56`
- entrypoint: `apps/api/src/middleware/admin.ts:78`
- parallel admin proxy control: `apps/admin/src/proxy.ts:71`
- admin route mount: `apps/api/src/routes/admin/router.ts:155`
- missing infra control: `infra/terraform/global/main.tf:295`, `infra/terraform/modules/region/main.tf:348`

Attack path:

1. Attacker reaches `/v1/admin/*` or the admin proxy path.
2. Attacker supplies `x-goog-iap-jwt-assertion` with an unsigned/forged JWT payload containing `role: "admin"`.
3. `verifyAdminJwt` decodes payload and checks role/expiry only.
4. Admin route sees `adminSubject` and executes protected read/write operations.

Counterevidence: comments say IAP already verified the assertion, but Terraform does not configure IAP and runtime accepted the forged header. This is not dispositive counterevidence.

Severity: Critical if admin/API backend is internet/LB reachable with attacker-controllable headers; High if a trusted edge always strips/injects the header. Repository evidence supports Critical because the expected edge enforcement is not wired.

Decision: report.

## AP2 - Cross-User Data And Consent Control By Spoofed Owner Header

Affected lines:

- root control: `apps/api/src/routes/me.ts:47`
- consent gate: `apps/api/src/middleware/consent-gate.ts:28`
- OTP no-session result: `apps/api/src/routes/auth.ts:61`
- mobile placeholder token: `apps/mobile/app/(auth)/login.tsx:71`
- region explicit owner: `apps/api/src/routes/region.ts:56`

Attack path:

1. Attacker calls owner-scoped routes with `x-vsbs-owner: victim-id`.
2. API treats that value as the owner.
3. Data export, consent, erasure, and consent-gated routes execute under the victim owner id.
4. Other flows such as payment/sensors/autonomy rely on the same broken identity/consent basis.

Counterevidence: comments say real auth lands in a future phase. That confirms, rather than defeats, the current gap.

Severity: Critical. This is a broad tenant-boundary/authentication failure over PII and user-controlled consent.

Decision: report.

## AP3 - Unauthenticated Payment Manipulation

Affected lines:

- root control: `apps/api/src/routes/payment.ts:48`
- state-changing sinks: `apps/api/src/routes/payment.ts:66`, `apps/api/src/routes/payment.ts:83`, `apps/api/src/routes/payment.ts:93`, `apps/api/src/routes/payment.ts:99`
- router order: `apps/api/src/server.ts:351`, `apps/api/src/server.ts:387`

Attack path:

1. Attacker posts directly to `/v1/payments/orders`.
2. Router validates shape only and creates an order.
3. Sibling endpoints allow intent creation, authorization, capture, and refund by object id.
4. Consent middleware is mounted after the payment route and did not prevent order creation in runtime reproduction.

Counterevidence: payment mode may be sim in local/dev. The same route is production code and Terraform does not set live/auth mode or an auth gate.

Severity: High. If connected to live PSP credentials, impact can become Critical due unauthorized payment/refund state changes.

Decision: report.

## AP4 - Autonomy Grant Minting And Control Without Real Owner Proof

Affected lines:

- root control: `apps/api/src/routes/autonomy.ts:99`
- grant sign sink: `apps/api/src/routes/autonomy.ts:195`
- sim signature primitive: `packages/shared/src/commandgrant-lifecycle.ts:183`, `packages/shared/src/commandgrant-lifecycle.ts:274`
- action/revoke/perform: `apps/api/src/routes/autonomy.ts:215`, `apps/api/src/routes/autonomy.ts:239`, `apps/api/src/routes/autonomy.ts:263`
- heartbeat missing token: `apps/api/src/routes/autonomy.ts:335`, `apps/api/src/routes/autonomy.ts:348`
- inline unsigned grant accept: `apps/api/src/server.ts:524`

Attack path:

1. Preconditions: `AUTONOMY_ENABLED=true` and `MERCEDES_IPP_MODE` remains unset or `sim`.
2. Attacker constructs a valid `CommandGrantSchema`.
3. Attacker computes deterministic sim owner signature using exported shared helper behavior.
4. `/v1/autonomy/grant/sign` accepts and witnesses the grant.
5. Attacker can then append actions, revoke, perform scope, or use heartbeat/offline envelope paths without owner/grantee authentication.

Counterevidence: README/roadmap prohibit real safety deployment and say autonomy should be enabled only after go-live gates. That lowers current production likelihood if operators follow docs, but the code path is direct once enabled.

Severity: Critical for any pilot/prod environment enabling autonomy; High in the current research reference posture.

Decision: report.

## AP5 - Concierge PII Disclosure

Affected lines:

- root control: `apps/api/src/routes/concierge.ts:53`
- storage sink: `apps/api/src/routes/concierge.ts:126`
- read sink: `apps/api/src/routes/concierge.ts:132`

Attack path:

1. Caller chooses or learns a `conversationId`.
2. Messages with phone/VIN/repair details are stored under that id.
3. Any caller reads `/v1/concierge/threads/:id`.

Counterevidence: the store is in-memory, so impact is per process lifetime. Conversation ids may be opaque in some clients, but the API does not enforce that.

Severity: High due PII disclosure from a public endpoint.

Decision: report.

## AP6 - Telemetry And Sensor Poisoning

Affected lines:

- root controls: `apps/api/src/routes/sensors.ts:65`, `apps/api/src/routes/sensors.ts:99`
- public consent seed: `apps/api/src/routes/scenarios.ts:196`
- telemetry ingest: `apps/api/src/routes/autonomy.ts:572`, `apps/api/src/routes/autonomy.ts:584`
- not guarded note: `apps/api/src/routes/autonomy.ts:521`

Attack path:

1. Attacker seeds consent for a chosen `userId` through public scenario bootstrap.
2. Attacker sends `x-vsbs-owner` for that id and posts sensor samples for a chosen vehicle.
3. Latest sensor state and/or dashboard telemetry for arbitrary ids is poisoned/read.
4. For autonomy dashboard streams, event and telemetry ingest do not require even `AUTONOMY_ENABLED`.

Counterevidence: routes are demo/pilot oriented, but they are mounted in the main API and no network-level separation is present in code.

Severity: High because telemetry is a high-value asset in the threat model and can influence operator perception and demo/autonomy dashboards.

Decision: report.

## AP7 - Recording Subprocess Abuse

Affected lines:

- entrypoint: `apps/api/src/routes/recordings.ts:51`
- listing/file sinks: `apps/api/src/routes/recordings.ts:80`, `apps/api/src/routes/recordings.ts:195`
- process spawn: `apps/api/src/adapters/recordings/orchestrator.ts:194`
- timeout: `apps/api/src/adapters/recordings/orchestrator.ts:153`

Attack path:

1. Attacker calls `/v1/recordings/start`.
2. API starts the demo recording orchestrator.
3. Orchestrator spawns the CARLA recording shell script and holds the single worker until completion/timeout.
4. Attacker repeats to occupy CPU/disk/process resources and enumerate/read generated outputs.

Counterevidence: one-at-a-time lock exists and script path is constant, so this is not command injection. It remains unauthenticated privileged job triggering.

Severity: Medium to High depending on deployed recording dependencies and resource limits.

Decision: report.

## AP8 - Edge And Deployment Controls Not Connected

Affected lines:

- Cloud Armor defined: `infra/terraform/global/main.tf:141`, `infra/terraform/security.tf:61`
- not attached to backends: `infra/terraform/modules/region/main.tf:348`, `infra/terraform/modules/region/main.tf:367`, `infra/terraform/modules/region/main.tf:489`
- output says attach manually: `infra/terraform/global/main.tf:419`
- app fail-open on missing edge header: `apps/api/src/middleware/cloud-armor.ts:30`
- IAP only comment/path route: `infra/terraform/global/main.tf:295`
- broken deploy config: `.github/workflows/ci.yml:60`

Attack path:

1. Operators deploy from repository Terraform/CI expecting Cloud Armor and IAP.
2. Backend services do not get the Cloud Armor security policy and no IAP backend config is present.
3. App middleware allows missing Cloud Armor verdict headers.
4. Admin and public route bugs remain exposed; deploy job itself references missing Cloud Build config.

Counterevidence: controls might be manually applied outside Terraform, but repository evidence does not establish that and should not be assumed.

Severity: High production readiness/security-control failure.

Decision: report.

## AP9 - Sim Defaults And Proxy Miswiring

Affected lines:

- env defaults: `apps/api/src/env.ts:8`, `apps/api/src/env.ts:48`, `apps/api/src/env.ts:73`, `apps/api/src/env.ts:83`, `apps/api/src/env.ts:88`, `apps/api/src/env.ts:103`
- Terraform env omissions: `infra/terraform/modules/region/main.tf:165`, `infra/terraform/modules/region/main.tf:190`
- web/admin proxy defaults: `apps/web/src/app/api/proxy/[...path]/route.ts:10`, `apps/admin/src/app/api/proxy/[...path]/route.ts:13`
- Terraform sets different var: `infra/terraform/modules/region/main.tf:294`

Attack path:

1. Cloud Run is provisioned from Terraform.
2. Required security/live-mode env vars are absent, so API falls back to defaults unless image/runtime adds them elsewhere.
3. Web/admin server-side proxy uses `VSBS_API_BASE`, but Terraform sets `NEXT_PUBLIC_API_BASE`; proxy falls back to localhost.
4. Production either fails to connect or runs sim/default behavior.

Counterevidence: manual env injection can fix this. It is still not connected "as it should be in prod" in the repo.

Severity: Medium/High operational security and availability issue.

Decision: report.

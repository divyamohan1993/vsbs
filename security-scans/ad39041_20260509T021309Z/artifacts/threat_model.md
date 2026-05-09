# Vehicle Service Booking System Repository Threat Model

## Overview

VSBS is a research-grade autonomous vehicle service booking reference system. The repository contains a Bun/Hono API (`apps/api`), customer Next.js web app (`apps/web`), operator/admin Next.js app (`apps/admin`), Expo owner app (`apps/mobile`), shared safety/autonomy/payment/consent packages, LLM agent orchestration, sensor simulation and telemetry, compliance utilities, and Google Cloud Terraform.

The real production assets are customer identity, phone numbers, VINs, vehicle telemetry, booking and service status, payment order state, consent and erasure records, admin/operator actions, CommandGrant autonomy capability tokens, passkey credentials, witness signing keys, OEM/Smartcar/Mercedes IPP tokens, LLM provider keys, and deployment controls.

This repository explicitly warns that it is not a certified safety system. Legitimate production use is the advisory dashboard, back-office booking, consent/compliance, and simulation surfaces unless a deployer completes the safety, legal, regulatory, and insurance gates in `SAFETY-NOTICE.md` and `docs/roadmap-prod-deploy.md`.

## Threat Model, Trust Boundaries, and Assumptions

Primary runtime surfaces:

- Public customer web routes in `apps/web`, using `/api/proxy/*` to reach `apps/api`.
- Public API routes under `/v1/*`, including auth, bookings, concierge SSE, payments, intake, recordings, region, sensors, autonomy, LLM diagnostics, KB, safety, PHM, and metrics.
- Operator/admin UI and `/v1/admin/*`, intended to be IAP-gated in production.
- Mobile owner app, including passkeys, offline queue, OBD/BLE, camera, audio, push notification HMAC verification, and region selection.
- LLM agent graph in `packages/agents`, which calls API tools from untrusted natural-language input.
- Terraform-managed GCP edge, Cloud Run services, Secret Manager, Firestore, Cloud Armor, WAF, regional routing, and CI/CD.

Trust boundaries:

- Anonymous internet client to web/API edge.
- Browser/mobile device to API, including caller-controlled headers, cookies, and request bodies.
- Customer-owned identity/session to owner-scoped booking, consent, telemetry, payment, and erasure records.
- Operator/admin identities to privileged operational data and mutating admin workflows.
- LLM-generated tool calls to deterministic API side effects.
- Simulated sensor/CARLA/chaos data to real telemetry and decision logs.
- API service account to GCP data stores, Secret Manager, KMS, Pub/Sub, and external providers.
- Cloud Load Balancer/Cloud Armor/IAP to Cloud Run services.
- GitHub Actions OIDC and release signing to deployable artifacts.

Attacker-controlled inputs include all HTTP request bodies, query strings, dynamic path segments, SSE subscription IDs, `x-vsbs-owner`, `x-forwarded-for`, `x-goog-iap-jwt-assertion` if a service is directly reachable or header overwrite is possible, uploaded multipart files, OTP start/verify requests, LLM prompts, telemetry ingest frames, recording IDs, booking IDs, and Terraform variables supplied by operators.

Operator-controlled inputs include environment variables, secret values, Terraform flags, backend service wiring, Cloud Run ingress/IAM, provider credentials, model pins, allowed origins, and admin IAP membership.

Developer-controlled inputs include source, tests, CI workflows, release artifacts, generated build outputs, fixtures, sim recordings, and docs.

Production assumptions that must hold:

- Public services must have a real authentication/session layer and must not rely on caller-controlled identity headers.
- Demo/sim shortcuts must be disabled or fail closed when `NODE_ENV=production`.
- Admin routes must be protected by verified IAP/JWT signatures and Cloud Run ingress/IAM, not just trusted header presence.
- Cloud Armor/WAF/IAP policies must actually be attached to the deployed backend services.
- Autonomy-grant signing must verify real owner passkey assertions or trusted public keys before witness co-signing.
- Payment capture/refund must be bound to authenticated users, booking ownership, and provider webhook verification.
- Consent and erasure operations must resolve owner identity from verified auth context.
- Telemetry and sensor ingest must authenticate the producer and distinguish sim from real data.

## Attack Surface, Mitigations, and Attacker Stories

Important existing mitigations:

- Zod schemas at most HTTP and package boundaries.
- Hono request IDs, body-size limits, rate limiting, secure headers, Cloud Armor middleware, and unified error envelopes.
- Strict CSP in web/admin proxy middleware and security headers in Next config.
- PII redaction utilities and logging middleware.
- Consent manager, erasure coordinator, and jurisdiction policy utilities.
- CommandGrant canonicalization, Merkle authority chain helpers, passkey bridge package, offline envelope signatures, and dual-control helpers.
- Payment state machine and Razorpay webhook HMAC in live mode.
- Sensor provenance types and signed-frame utilities.
- Security scanning workflows with Trivy, OSV, Semgrep, and pnpm audit.
- Terraform intent for Cloud Armor, regional data planes, Secret Manager, Firestore PITR, Binary Authorization, and VPC-SC.

High-value attacker stories:

- An unauthenticated caller spoofs an owner header or predictable ID to read or mutate another user's consent, erasure, booking, or conversation state.
- A caller invokes payment capture/refund or autonomy grant/action endpoints directly because the HTTP layer does not require an authenticated principal or ownership check.
- A caller forges admin/IAP headers if direct ingress or proxy header trust is misconfigured.
- A prompt injection causes the agent to call high-impact tools; the verifier and red-team fences reduce this risk but do not replace server-side authz.
- A telemetry producer injects synthetic or malicious frames into a booking dashboard or decision stream.
- A deployment operator believes Cloud Armor/IAP/Binary Authorization is active because Terraform defines it, while the backend services or workflows are not wired to enforce it.
- A leaked local `.env` key or committed/packaged build artifact exposes provider credentials or debug state.

Less realistic or out-of-scope stories:

- Direct actuator control on a public road is prohibited by the safety notice and should be treated as out of scope unless a deployer separately completes the required certifications.
- Hardware compromise inside the OEM vehicle stack is outside VSBS's direct boundary, though adapter tokens and grants are in scope.
- Dependency CVEs already reported upstream are lower priority unless the vulnerable package is reachable in a deployed path.

## Severity Calibration

Critical:

- Unauthenticated or forged-owner access to payment capture/refund, CommandGrant minting/perform/revocation, erasure, or admin mutation in a production deployment.
- Any path that can turn simulated autonomy or sensor data into real autonomous authority without owner passkey, witness, and audit-chain checks.
- Production deployment missing edge/IAP/WAF wiring while code assumes those controls exist.

High:

- Cross-user data exposure of PII, VIN, phone, telemetry, consent logs, erasure receipts, booking records, recordings, or concierge history.
- Public telemetry/event ingest or recording export that can poison operator/customer dashboards or leak generated media.
- Weak live-mode fallback to sim drivers for auth, payment, autonomy, or OEM adapters.
- CI/CD or Terraform gaps that make production deployment fail open or fail silently.

Medium:

- Public diagnostic endpoints exposing model/provider configuration or enabling bounded LLM spend without auth.
- Rate limiting keyed on spoofable headers when direct requests can set `x-forwarded-for`.
- CSP or header gaps that increase XSS impact but do not expose a direct sink.
- Local-only secrets present in an ignored `.env` that could leak through backups or operator error.

Low:

- Demo-only placeholder data exposure when clearly isolated from real users.
- Documentation mismatches that do not affect deployed controls.
- Non-sensitive route enumeration or health metadata disclosure.

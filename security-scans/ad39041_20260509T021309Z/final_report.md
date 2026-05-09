# Security Scan Final Report

Verdict: this repository does not hold the ground for production. It is consistent with the README warning that this is research-grade/reference software, not a production-certified system. The largest issue is not one isolated bug; the app currently lacks a real identity boundary and depends on edge/IAP/security controls that the Terraform does not actually attach.

## Confirmed High-Impact Findings

1. Critical - forged admin access: unsigned/forged `x-goog-iap-jwt-assertion` with `role: admin` reached `/v1/admin/bookings` with `200`.
2. Critical - no real user session: `x-vsbs-owner` controls owner identity for `/v1/me`, consent, erasure/data export, region, and consent-gated flows.
3. High/Critical - payments are unauthenticated: `/v1/payments/orders` returned `201`; sibling endpoints create intents, authorize, capture, and refund by id.
4. Critical when autonomy is enabled - autonomy grants can be minted with sim signatures in production-mode runtime if `MERCEDES_IPP_MODE` is not live; PoC returned `201`.
5. High - public concierge thread read leaks stored messages/PII by caller-controlled `conversationId`.
6. High - sensor/telemetry state can be poisoned/read after unauth public consent bootstrap; dashboard telemetry/event ingest is also unauthenticated.
7. Medium/High - recordings API lets anonymous callers start a long-running subprocess and enumerate/read generated recording artifacts.
8. High - Cloud Armor/IAP are assumed in code/docs but not attached/enforced in Terraform; app Cloud Armor middleware defaults fail-open.
9. Medium/High - production wiring is incomplete: API defaults to dev/sim modes unless overridden, web/admin proxy expects `VSBS_API_BASE` but Terraform sets `NEXT_PUBLIC_API_BASE`, and CI deploy references missing `deploy/cloudbuild.yaml`.
10. Medium - dependency audit found 7 high advisories in mobile transitive dependencies (`@xmldom/xmldom`, `fast-uri`); no direct exploit path was confirmed.

## Most Urgent Fix Order

1. Add a real auth/session middleware and remove all trust in `x-vsbs-owner` and explicit owner ids from public callers.
2. Replace admin JWT parsing with real IAP JWT verification or signed internal identity, and fail closed unless the request came through a verified edge path.
3. Put authz/ownership checks before payments, sensors, autonomy, concierge thread reads, recordings, and scenario bootstrap.
4. Remove sim drivers from production startup unless an explicit `APP_DEMO_MODE=true` non-prod invariant is satisfied; fail startup when live-mode secrets/settings are missing.
5. Attach Cloud Armor to every backend service, implement actual IAP config/IAM for admin, and make missing edge verdict headers fail closed where expected.
6. Fix Terraform/CI production wiring: set `NODE_ENV=production`, `AUTH_MODE=live`, `PAYMENT_MODE=live`, `VSBS_API_BASE`, live PSP/OEM secrets, and replace or add `deploy/cloudbuild.yaml`.

## Verification Performed

- Runtime probe through the real Hono app object with production-mode flags: `/tmp/codex-security-scans/vehicle-service-booking-system/ad39041_20260509T021309Z/artifacts/pocs/runtime-probes.ts`.
- Static code tracing across API routes, Next proxies, mobile auth, Terraform, workflows, and shared security/autonomy/payment contracts.
- Dependency audit through `bun x pnpm@9.12.3 audit --prod --audit-level high`.

## Scan Bundle

- Threat model: `artifacts/threat_model.md`
- Runtime inventory: `artifacts/runtime_inventory.md`
- Discovery: `artifacts/finding_discovery_report.md`
- Validation: `artifacts/validation_report.md`
- Attack paths: `artifacts/attack_path_analysis.md`
- PoC: `artifacts/pocs/runtime-probes.ts`

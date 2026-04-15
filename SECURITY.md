# Security Policy

## Supported versions

VSBS is pre-1.0. Only the `main` branch receives security fixes today. Tagged releases will adopt standard semver support windows post-1.0.

| Version | Supported |
| ------- | --------- |
| main    | yes       |
| < 1.0   | no        |

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Use one of these channels:

- **Preferred:** GitHub Security Advisories — click *Report a vulnerability* on [the security tab](https://github.com/divyamohan1993/vsbs/security/advisories/new). This creates a private thread with the maintainers.
- **Email:** `contact@dmj.one` with subject `[VSBS security]`. PGP welcome; request the key in the first message.

Please include:

1. A clear description of the issue.
2. Affected component (`packages/*`, `apps/*`, `infra/*`).
3. Proof-of-concept or reproduction steps.
4. Impact assessment (what can an attacker do?).
5. Your disclosure preference (coordinated, embargoed, public).

## Response timeline

- **Acknowledgement:** within 72 hours.
- **Triage + severity assignment:** within 7 days.
- **Fix or mitigation plan:** within 30 days for high/critical; 90 days for medium; best-effort for low.
- **Public disclosure:** coordinated with the reporter. Default embargo 90 days from triage.

## Scope

In scope:
- Authentication, consent, and authorisation flows.
- Safety red-flag logic (`packages/shared/src/safety.ts`).
- Autonomy `CommandGrant` minting, verification, and revocation.
- Payment adapters and idempotency.
- Defense-in-depth middleware (`apps/api/src/middleware/*`).
- PII handling + DPDP consent flow.
- Agent tool-use (prompt injection, excessive agency).
- Infrastructure (Terraform, Cloud Run, IAM).

Out of scope:
- Denial-of-service via unauthenticated flood on a public demo.
- Reports requiring a compromised developer machine or leaked credentials outside VSBS.
- Findings against third-party dependencies already reported upstream. Please report those to the upstream.

## Hall of fame

Reporters who follow coordinated disclosure are acknowledged in `CHANGELOG.md` and (with consent) in a public hall of fame. No bug-bounty payouts pre-1.0.

## Hardening posture

VSBS ships the following defense-in-depth controls out of the box. Any bypass is in scope.

- Strict CSP with nonce-based `script-src` and `frame-ancestors 'none'`.
- HSTS 2 years, `includeSubDomains`, `preload`.
- Request-id propagation, PII-redacting structured logging, body-size cap, sliding-window rate limit.
- Unified error envelope with `requestId` on every failure.
- Zod validation on every HTTP boundary and every agent tool argument.
- Verifier chain on every agent tool call.
- Post-quantum hybrid TLS envelope at rest (Cloud KMS ML-KEM-768 + X25519).
- Append-only consent log with evidence hashes for DPDP Rule 4.
- Red-flag safety set is hard-coded and non-overridable; post-commit second check gates any path that would let a customer drive.
- Signed, time-bounded, amount-bounded `CommandGrant` capability tokens with geofence and ≤ 6 h lifetime.

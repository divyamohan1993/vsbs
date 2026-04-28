# VSBS — key inventory + rotation schedule

> Author: Divya Mohan / dmj.one. Apache 2.0 + NOTICE preserved.
> References: docs/research/security.md §1, §5, §7; FIPS 203, FIPS 204;
> RFC 9180 (HPKE shape); GCP Cloud KMS PQ-KEM and PQ-signatures GA, 2026-Q1.

This is the live key inventory for VSBS. Each key has a fixed identifier,
algorithm, rotation cadence, and storage substrate. Key material is **never**
stored in code, repo, env files committed to git, container images, logs,
or error responses. All keys live in Secret Manager + Cloud KMS with PQ
hybrid envelopes per docs/research/security.md §1.

## Inventory

| Key id | Purpose | Algorithm | Storage | Rotation | Owner |
|--------|---------|-----------|---------|----------|-------|
| `vsbs/sign/witness-grant` | Server witness co-sign of CommandGrant | **ML-DSA-65** (FIPS 204) | Cloud KMS PQ asymmetric-sign | 180 d | Security |
| `vsbs/sign/release` | Sigstore attestation of container builds (Binary Authorization) | **ML-DSA-65** (FIPS 204) | Cloud KMS PQ asymmetric-sign | 365 d | Release |
| `vsbs/kek/customer-pii/<region>` | KEK over customer PII envelope DEKs | **ML-KEM-768 + X25519 hybrid** | Cloud KMS PQ-KEM | 90 d | Security |
| `vsbs/kek/refresh-tokens/<region>` | KEK over OAuth refresh tokens | ML-KEM-768 + X25519 hybrid | Cloud KMS PQ-KEM | 30 d | Security |
| `vsbs/kek/oem-tokens/<region>` | KEK over OEM (Smartcar / IPP) access tokens | ML-KEM-768 + X25519 hybrid | Cloud KMS PQ-KEM | 30 d | Security |
| `vsbs/dek/aes-256-gcm` | Per-record DEK derived per envelope | **AES-256-GCM** (NIST SP 800-38D) | In-memory only | Per record (single use) | runtime |
| `vsbs/hmac/region-token` | HMAC-SHA-256 for cross-region request tokens | HMAC-SHA-256 | Secret Manager versioned | 30 d | Platform |
| `vsbs/jwt/access-sign` | JWT short-lived access token signing | **EdDSA Ed25519** | Cloud KMS asymmetric-sign | 90 d | Security |
| `vsbs/jwt/refresh-encrypt` | Refresh token AES-256-GCM body key | AES-256-GCM (wrapped under KEK) | Wrapped via KMS envelope | 30 d | Security |
| `vsbs/webhook/sign` | HMAC for outbound webhook signing | HMAC-SHA-256 | Secret Manager versioned | 30 d | Integrations |
| `vsbs/auth/otp-secret` | Server-side seed for OTP correlation | random 256 bit | Secret Manager versioned | 30 d | Auth |
| `vsbs/db/password/main` | AlloyDB / Postgres operator password | random 24-char (safe set) | Secret Manager versioned | 30 d | Platform |
| `vsbs/recaptcha/site-key` | Site key (public) | n/a | Terraform output | n/a | Security |

The KEK / DEK split follows NIST SP 800-57 Part 1 §6 (key hierarchy) and
matches the construction documented in docs/research/security.md §1.

## Rotation mechanics

**Automated** rotations are enforced by `@vsbs/security/secrets`
(`SecretRotator.sweep()`) running on a Cloud Scheduler tick once a day. The
sweep walks every registered secret; secrets older than their cadence are
rotated and the previous version remains enabled in the ring for one cycle
(N, N-1, N-2). Consumers fetch by version-id where the freshness matters
(JWT verifier accepts current + previous), or simply consult `current()`.

**Manual** rotations are reserved for incident response. The runbook is
`docs/runbooks/key-rotation.md`. The triage path: disable the leaked
version (`SecretRotator.disable()`), force-rotate (`rotateSecret()`), then
revoke any active sessions / grants minted under the leaked version
(`buildRevocationAction` per signed grant).

**Cadence rationale**

- **30 d** (refresh tokens, webhooks, OEM tokens, db password, OTP seed,
  region HMAC) — matches the operational floor recommended by
  docs/research/security.md §5 ("Secret Manager + KMS auto-rotate on 30-day
  cadence for API keys"). Secrets that touch external boundaries rotate
  monthly so a leak is contained.
- **90 d** (customer-PII KEK, JWT access-sign, refresh-encrypt key) —
  long-tail keys with broader blast radius. Tied to the recommendation in
  NIST SP 800-57 for AES-256 wrap keys with high-volume use.
- **180 d** (witness signing key) — slow rotation because every prior
  artefact in the authority chain anchors back to historical witness keys;
  rotation requires a fresh CT log entry and a witness-rotation action in
  the chain.
- **365 d** (release signing key) — Sigstore-style ceremony involving an
  HSM operator; long cadence by industry convention.

## Failure modes + recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Secret Manager unavailable on boot | `/readyz` check fails | Cached versions on disk (encrypted with bootstrap KEK); requests served until cache TTL expires |
| KMS unavailable mid-request | Cloud Trace span errors | Circuit-break the encrypt/decrypt path; queue writes; alert on burn rate |
| Rotation stalls (lastRotated > 1.5x cadence) | `SecretRotator.due()` reports id; alert | Manual rotation via runbook; on-call paged |
| Leaked key (suspected) | Audit log review or external report | Disable -> rotate -> revoke sessions -> 72h DPDP breach notice if PII implicated |
| Quantum break on ECDSA | n/a (hypothetical) | Witness co-sign under ML-DSA-65 covers PQ; we re-mint grants with longer ML-DSA chain |

## Build-system keys

The CI pipeline never sees customer-data KEKs. CI signs container images
with `vsbs/sign/release` via Cloud Build's native KMS integration.
Workload Identity Federation is the only path; no service-account JSON keys
exist in the repo, env, or Secret Manager.

## Audit + lineage

Every rotation appends a `(secretId, oldVersion, newVersion, rotatedAt,
actor)` row to the `key_audit_log` Cloud Logging bucket (write-once,
365-day retention). The signed-receipt for witness rotations also appends
to the authority chain, anchoring key lifecycle to the same Merkle log
that anchors customer grants.

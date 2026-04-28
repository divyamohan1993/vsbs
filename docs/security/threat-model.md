# VSBS — STRIDE threat model: autonomous handoff

> Author: Divya Mohan / dmj.one. Apache 2.0 + NOTICE preserved.
> References: docs/research/security.md (synthesis), docs/research/autonomy.md
> (signed bounded revocable capability), docs/research/prognostics.md (PHM and
> SOTIF takeover), packages/shared/src/safety.ts (red-flag set), packages/shared/src/commandgrant-lifecycle.ts.

This is the production threat model for the **autonomous handoff path**, the
flow where the owner authorises the OEM (or VSBS-on-behalf-of-the-OEM) to
move the vehicle into the service centre under a signed, bounded,
revocable command grant. STRIDE is applied per asset; mitigations are
mapped to concrete code, infra, or process controls.

## Assets

| Id | Asset | Owner | Sensitivity |
|----|-------|-------|-------------|
| A1 | CommandGrant capability token | Owner | Critical |
| A2 | Owner private key (passkey) | Owner device | Critical |
| A3 | Server witness ML-DSA-65 key | VSBS | Critical |
| A4 | Authority chain (Merkle log) | VSBS + audit | High |
| A5 | Vehicle telemetry (origin: real) | Owner | High |
| A6 | Customer PII (name, phone, VIN, GPS) | Owner | Critical (DPDP) |
| A7 | Auto-pay cap | Owner | Critical |
| A8 | OEM access tokens (Smartcar / IPP) | VSBS | High |
| A9 | Admin SIEM | VSBS | Critical |

## Per-asset STRIDE

### A1. CommandGrant capability token

| | Threat | Mitigation |
|---|---|---|
| S | Spoofing — attacker mints a grant the owner did not authorise | Owner-side passkey signature over RFC 8785 canonical bytes; server verifies via packages/security/src/command-grant-passkey.ts; no grant accepted without challenge mint + assertion within TTL. |
| T | Tampering — bytes mutated between owner sign + server witness | Canonical byte scheme (sorted keys, no whitespace); both signatures cover the same byte stream; bytes hashed into authority chain. |
| R | Repudiation — owner denies authorising the grant | Authority chain (`packages/shared/src/commandgrant-lifecycle.ts` `appendAuthority`) makes the grant + every subsequent action append-only and Merkle-linked; owner signature is non-repudiable. |
| I | Information disclosure — grant content leaks via logs | PII redaction middleware (`apps/api/src/middleware/pii-redaction.ts`) removes VIN, phone, GPS before any log line emits; grant body never logged in plaintext. |
| D | Denial of service — replay attack floods grant verification | Cloud Armor rate-limit (200 r/min/IP, ban 1000/600s); app-layer sliding-window per-user (`@vsbs/security` rate-limit). |
| E | Elevation of privilege — narrow scope grant treated as broad | Each grant pins `tier`, `scopes[]`, `geofence`, `notBefore/notAfter`, `maxAutoPayInr`; verifier rejects out-of-scope actions. |

### A2. Owner private key (passkey)

| | Threat | Mitigation |
|---|---|---|
| S | Phishing assertion against bogus origin | WebAuthn `clientData.origin` strictly compared against allowed origin (`packages/security/src/webauthn.ts` `finishAuthentication`). |
| T | Authenticator data tampered to drop UV/UP | We require UP flag in every assertion; server re-derives `rpIdHash` from declared `rpId` and rejects mismatch. |
| R | Owner denies the assertion they made | Cred id + signCount stored; signCount monotonicity enforced — replay impossible past first reuse. |
| I | Private key extracted from device | Secure element / Secure Enclave / TPM is platform responsibility; VSBS never handles the private key. |
| D | Authenticator availability under load | Multiple credentials per user supported; OTP fallback (`apps/api/src/routes/auth.ts`) when passkey ceremony fails. |
| E | Cross-user credential acceptance | `byCredId` returns the bound `userId`; `finishAuthentication` rejects if mismatched. |

### A3. Server witness ML-DSA-65 key

| | Threat | Mitigation |
|---|---|---|
| S | Forged witness signature attributing co-sign to VSBS | Witness key generated + held in Cloud KMS PQ asymmetric-sign slot (`infra/terraform/security.tf` Binary Auth ties key to attestor service account). |
| T | Algorithm downgrade to RSA / ECDSA | `kek_alg`, `dek_alg`, and `witness.alg` are pinned in code (`packages/security/src/sig.ts` `ML_DSA_65_ALG`); enforce on read. |
| R | Operator denies a witness signature | Every co-sign is appended to the authority chain; chain hash anchors every action. |
| I | Witness key exfil via stack traces | Logger redaction; logs never include raw key material; secrets fetched at boot, never logged. |
| D | Witness service offline | Co-sign happens before grant becomes effective; offline witness blocks grant minting, fails closed (autonomy disabled). |
| E | Misuse of witness key for non-grant artefacts | Witness signs *only* `canonicalGrantBytes(grant)`; bytes are domain-separated by content. |

### A4. Authority chain (Merkle log)

| | Threat | Mitigation |
|---|---|---|
| S | Forged chain entry inserted post-hoc | Chain entries are `sha256(prev_hash || payload_hash)`; tamper invalidates all subsequent entries. |
| T | Reordering | Entries are content-addressed by their position in the chain; reordering changes hashes. |
| R | Operator denies chain state | Chain head signed periodically by witness; mirrored to a write-once Cloud Storage bucket with object retention. |
| I | Chain reveals customer behaviour patterns | Chain stores `payloadHash` + ids only, not bodies; linkable to bodies only for the data fiduciary under DPDP basis. |
| D | Chain DoS via flood | Per-grant + per-vehicle rate ceiling; per-tenant quota in admin pane. |
| E | Bypass — action accepted without chain append | Action handler rejects writes that don't carry a freshly appended entry; integration test in `commandgrant-lifecycle.test.ts`. |

### A5. Vehicle telemetry (origin: real)

| | Threat | Mitigation |
|---|---|---|
| S | Sim sample injected into real decision log | Every `SensorSample` carries `origin: "real" \| "sim"`; arbitration layer surfaces origin summary; sim samples cannot enter real customer decision logs (CLAUDE.md invariant 7). |
| T | OBD-II readings spoofed by aftermarket dongle | EKF cross-checks against GPS+IMU; SOTIF takeover triggers when innovation exceeds 3σ; PHM independently scores residual life. |
| R | Owner denies a fault was real | Sensor pipeline timestamps + signed fusion records. |
| I | Telemetry leaks driving habits | Field-level KMS envelope on telemetry tables; aggregate-only access for analytics. |
| D | Adversary floods telemetry channel | Per-vehicle quota; backoff in adapter; circuit breaker. |
| E | Sensor-derived privilege escalation | Sensor data never authorises actions on its own; the agent supervisor requires the explicit grant. |

### A6. Customer PII

| | Threat | Mitigation |
|---|---|---|
| S | Identity confusion via shared phone | Identity bound to passkey + OTP combination; each grant pins `vehicleId` and `granteeSvcCenterId`. |
| T | DB row mutated bypassing app | KMS envelope means raw bytes are useless without DEK; app-level invariants enforced via Zod on read. |
| R | Erasure denied | DPDP Rule 10: `DELETE /me` cascades; cryptographic erasure for backups (shred per-user DEK). |
| I | PII in logs / prompts / errors | `RedactingLogger`, `RedactionEngine.redactForLLM`, error envelope strips internals. |
| D | DELETE flood empties tables | Erasure rate-limited per principal; admin-gated bulk delete. |
| E | Field-level escalation (e.g. read VIN -> read everything) | Per-field VPC-SC + per-table IAM; `infra/terraform/security.tf` `vsbs_prod_asia_south1` perimeter. |

### A7. Auto-pay cap

| | Threat | Mitigation |
|---|---|---|
| S | Forged signed cap | Cap is bound inside the grant and signed by the owner; verifier checks cap is within `maxAutoPayInr`. |
| T | Cap mutated mid-flight | Cap is part of canonical bytes; tamper invalidates owner signature. |
| R | Operator denies cap was honoured | Authority chain logs each capture against the cap; exceeded cap raises pager. |
| I | Cap leaks to another tenant | Cap visibility scoped to grantee + owner. |
| D | Cap exhaustion DoS | Per-grant cap is monotonically decreasing; new capture against grant rejected after exhaustion. |
| E | Cap escalation via tier change | `tier` is part of canonical bytes; can't change without re-mint. |

### A8. OEM access tokens

| | Threat | Mitigation |
|---|---|---|
| S | Adversary impersonates OEM with stale token | Tokens stored encrypted (KMS envelope); refresh-rotation on; per-vehicle scoping. |
| T | Token tampered in transit | HTTPS everywhere; `secureHeaders` enforces HSTS; tokens never travel in URL paths. |
| R | OEM denies a call we made | We log adapter request id + OEM correlation id; chain anchored to authority log. |
| I | Token leaked via stack trace | Logger redaction; never embedded in error messages. |
| D | OEM rate-limits us | Adapter circuit breaker + sim-mode fallback per simulation policy. |
| E | Token-scope escalation across tenants | Adapter binds token to `vehicleId`; cross-vehicle calls rejected. |

### A9. Admin SIEM

| | Threat | Mitigation |
|---|---|---|
| S | Insider impersonates another admin | BeyondCorp + IAP gating; per-action approval for high-risk operations. |
| T | Audit log tampered | Append-only Cloud Logging bucket; periodic export to immutable storage. |
| R | Admin denies an action | Session recording + per-action signed receipt. |
| I | Customer PII visible in feed | Redaction middleware applied before SIEM ingestion. |
| D | SIEM unavailable | Read-only fallback dashboard + paging for outages. |
| E | Read-only admin elevates to write | Role-based ACL; deny-by-default; least-privilege from boot. |

## Compound flows

### Owner mints grant -> service centre executes

1. Owner intake -> server mints `CommandGrantTemplate`.
2. Server starts WebAuthn assertion ceremony with `challenge = sha256(canonicalGrantBytes)`.
3. Owner device asserts -> server verifies `clientData.origin`, signCount, signature.
4. Server witness co-signs with ML-DSA-65 (PQ-resilient).
5. Authority chain appends the grant.
6. Service centre presents the grant + a signed action; vehicle adapter validates against grant, executes, appends action.

A failure at any step fails closed: the vehicle never moves without owner sign + witness co-sign + chain append.

## Out of scope

- Hardware tampering at the OEM (out of our trust boundary; relies on the OEM's TPM / HSM).
- Insider attacks at the customer's home (we cannot prevent the owner being coerced; we mitigate via UP flag, TTL, revocation `buildRevocationAction`).
- Quantum cryptanalytic break of ECDSA P-256 / Ed25519 *before* the owner's keypair rotates — we mitigate by witness co-signing under ML-DSA-65 and by enforcing 90-day passkey rotation for high-value vehicles.

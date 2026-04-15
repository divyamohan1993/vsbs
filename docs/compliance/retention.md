# Data retention schedule

**Regulatory basis:** DPDP Act 2023 s.8(7) and DPDP Rule 10 (erasure); GDPR Art. 5(1)(e) storage limitation and Art. 17 (erasure).
**Version:** 1.0.0
**Date:** 2026-04-15
**Source of purposes:** `ConsentPurposeSchema` in `packages/shared/src/schema/consent.ts`.

## Principles

1. Retention is per-purpose, not per-account. Erasing one purpose does not erase the others.
2. Longest legally mandated period among statutes wins (for example, India tax law for invoices).
3. Cryptographic erasure (shredding the per-user DEK) is acceptable where row-level delete is infeasible (backups, immutable logs).
4. Erasure cascades to Firestore, Cloud Storage, BigQuery, and backups per DPDP Rule 10.
5. Trigger events are either time-based (retention period elapsed) or user-initiated (withdrawal, account deletion).

## Schedule

| Purpose (consent.ts) | Legal basis | Retention period | Erasure mechanism | Trigger | Owner |
|---|---|---|---|---|---|
| `service-fulfilment` | Contract, DPDP s.7(b); Income Tax Act 1961 s.44AA and GST invoice rules | 7 years from end of financial year of last booking | Row delete in Firestore, Cloud Storage object delete, BQ row delete; cryptographic shred of per-user DEK for backups | Time elapsed or account deletion plus retention exhaustion | Finance |
| `diagnostic-telemetry` | Consent | 24 months rolling per sample | Time-partitioned delete at 24 months; withdrawal triggers immediate delete | Withdrawal or 24-month rollover | Data lead |
| `voice-photo-processing` | Consent | 30 days from capture | Row and object delete; DEK shred on backups | Withdrawal or 30-day rollover | Data lead |
| `marketing` | Consent, opt-in | Until withdrawal or 24 months of inactivity | Row delete, marketing vendor purge via API, suppression list retained hashed | Withdrawal or inactivity | Growth |
| `ml-improvement-anonymised` | Consent, opt-in | 36 months after differential-privacy aggregation; raw source deleted at 30 days | Raw row delete at 30 days; aggregate rolled over at 36 months | Time elapsed | AI lead |
| `autonomy-delegation` | Consent, opt-in; insurer and regulator audit | 7 years from grant expiry | Authority log is append-only Merkle; DEK shred for encrypted payloads; hash chain retained for audit | 7 years after `notAfter` | Safety lead |
| `autopay-within-cap` | Consent, opt-in; Income Tax Act s.44AA and GST invoice rules | 7 years from end of financial year of last transaction | Payment intent metadata retained at PSP; our copy row-deleted; DEK shred on backups | Time elapsed | Finance |

## Special-case rows

| Data | Retention | Basis |
|---|---|---|
| `consent_log` rows | 7 years after purpose retention ends | Proof of lawful processing, DPDP Rule 3 |
| `ai_decision_log` | 3 years from decision | GDPR Art. 22 explainability; AI Act Art. 12 logging |
| `authority_log` (Merkle) | 7 years from grant expiry | Insurer audit and AI Act traceability |
| Security audit logs | 1 year hot, 6 years cold, per CERT-In directions | CERT-In direction dated 28 April 2022 |
| Backups | 35-day rolling; older generations shredded cryptographically | Disaster recovery RPO |

## Erasure flow

1. User triggers `DELETE /me` or a per-purpose withdrawal toggle.
2. Erasure worker marks the relevant rows tombstoned and enqueues cascade jobs.
3. Cascade: Firestore -> Cloud Storage -> BigQuery -> PSP metadata API -> downstream analytics copies -> backup DEK shred.
4. A completion receipt is written to `erasure_receipts/` with a SHA-256 over the affected row ids and a signed timestamp.
5. If any downstream refuses to erase (legal hold, active investigation), the receipt lists the hold and the expected release date. The user is notified.

## Holds and exceptions

- Legal hold: retention is paused and erasure deferred until the hold is released by legal counsel. Documented in `incidents/legal-holds.md`.
- Active incident: rows in the blast radius are frozen per the breach runbook until the post-mortem closes.
- Safety investigation by a regulator: authority log segments are preserved under the shortest of (regulator order period, 10 years).

## Review cadence

Reviewed annually or on any material change to the purposes enum in `packages/shared/src/schema/consent.ts`, whichever is sooner. Drift between this schedule and the enum is itself a finding and is treated as a SEV-3 incident.

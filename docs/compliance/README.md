# Compliance index

This directory is the home of artefacts required by regulators and auditors. Every entry points to the file or the location on GCP where the artefact lives.

## India — DPDP Act 2023 + DPDP Rules 2025

| Item | Location |
|---|---|
| Privacy notice (versioned, all locales) | `docs/compliance/notices/` and Firestore `consent_notices/` |
| Consent log (append-only) | Firestore `consent_log/` |
| Data-fiduciary contact | `docs/compliance/contacts.md` |
| Breach notification runbook (72 h) | `docs/compliance/breach-runbook.md` |
| Data-retention schedule | `docs/compliance/retention.md` |
| Significant Data Fiduciary self-assessment | `docs/compliance/sdf-self-assessment.md` |
| Consent Manager integration | `apps/api/src/adapters/consent-manager.ts` (stub) + runtime config |
| Cross-border transfer register | `docs/compliance/xborder.md` |

References: `docs/research/security.md` §2.

## EU — GDPR + AI Act

| Item | Location |
|---|---|
| DPIA | `docs/compliance/dpia.md` |
| FRIA (Fundamental Rights Impact Assessment for autonomy + auto-pay) | `docs/compliance/fria.md` |
| Article 22 explainability log | Firestore `ai_decision_log/` |
| Data Protection Officer contact | `docs/compliance/contacts.md` |

## AI risk register

`docs/compliance/ai-risk-register.md` — one row per identified risk, mapped to NIST AI RMF 1.0 and OWASP GenAI Top 10 2025 controls. See `docs/research/security.md` §4.

## Standards conformance

| Standard | Scope in VSBS |
|---|---|
| ISO 13374 | PHM pipeline stages in `packages/sensors` + `packages/shared/src/phm.ts` |
| ISO 21448 (SOTIF) | Safety invariants in `docs/architecture.md`, arbitration in `packages/sensors/src/fusion.ts` |
| ISO 26262 | Component criticality in `packages/shared/src/phm.ts` |
| ISO 3779 | VIN validator in `packages/shared/src/schema/vehicle.ts` |
| FIPS 203 / 204 / 205 | Cloud KMS envelope + ML-DSA code signing |
| WCAG 2.2 AAA | Design tokens + axe CI in `apps/web` |

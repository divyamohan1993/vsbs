# Per-jurisdiction policy matrix

**Version:** 1.0.0
**Date:** 2026-04-15
**Owner:** DPO (Divya Mohan, dmj.one)

VSBS resolves an applicable policy per user jurisdiction at request time. The
authoritative source is `packages/compliance/src/jurisdiction.ts`; this
document is the human-readable counterpart and the cross-reference for
auditors.

## Buckets

| Code | Population | Regulation | Lead authority |
|---|---|---|---|
| `IN` | India | DPDP Act 2023, DPDP Rules 2025 | Data Protection Board of India |
| `EU` | EEA member states | GDPR (EU 2016/679), EU AI Act (EU 2024/1689) | Lead supervisory authority per Art. 56 |
| `UK` | United Kingdom | UK GDPR, Data Protection Act 2018 | Information Commissioner's Office (ICO) |
| `US-CA` | California residents | CCPA + CPRA | California Privacy Protection Agency (CPPA) |
| `US-other` | Rest of the United States | State patchwork (VCDPA, CPA, CTDPA, UCPA, ...) plus sectoral federal (HIPAA, GLBA, FCRA, COPPA) | State Attorney General |
| `other` | Anywhere else | Falls back to a GDPR-equivalent posture | Local supervisory authority where one is designated |

## Side-by-side matrix

| Topic | IN (DPDP) | EU (GDPR + AI Act) | UK (UK GDPR) | US-CA (CCPA/CPRA) | US-other |
|---|---|---|---|---|---|
| Lawful bases | consent, contract, legal-obligation, vital-interest | full Art. 6 set | full UK GDPR set | consent, contract, legitimate interest, legal obligation | as above |
| Required notice | DPDP Rule 3 notice, Data Fiduciary contact, DPO contact (SDF), cross-border disclosure | Art. 13/14 notice, DPO contact, data-subject-rights summary, AI Act Art. 13 transparency for high-risk | UK GDPR Art. 13/14 notice, DPO/representative contact, ICO complaint route | CCPA Notice at Collection, Right to Know/Delete/Correct/Limit, "Do Not Sell or Share My PI" link, Privacy Policy with PI categories | Privacy Policy, PI categories, opt-out for targeted ads where applicable |
| Right to erasure | yes (s.12) | yes (Art. 17) | yes (UK GDPR Art. 17) | yes (s.1798.105) | yes for most state laws |
| Right to portability | not a primary right | yes (Art. 20) | yes | yes | varies, treated as yes |
| Right to object to automated decision | not directly | yes (Art. 22) | yes | yes (Limit Use of Sensitive PI plus opt-out) | mostly no |
| Data localisation | India residency by default (asia-south1) | EEA residency by default | not mandated | not mandated | not mandated |
| DPO required | for Significant Data Fiduciary | yes for public bodies, large-scale monitoring, special categories | yes in same conditions as GDPR | not mandated | not mandated |
| Breach notification | 72 h to DPB (Rule 7) | 72 h to lead supervisory authority (Art. 33) | 72 h to ICO | most state breach laws use "without unreasonable delay", typically 30 days | varies |
| Age of digital consent | 18 (DPDP s.9 children) | 16 (lower in some MSes per Art. 8) | 13 (DPA 2018) | 13 (COPPA aligned) | 13 |
| Sale opt-out required | not applicable | not applicable | not applicable | yes (CCPA + CPRA) | yes in several states (VCDPA, CPA, ...) |

## Operational implications in code

| Concern | Where it lives |
|---|---|
| Resolve current policy for a user | `resolvePolicy(jurisdiction)` in `packages/compliance/src/jurisdiction.ts` |
| Map country/state to bucket | `jurisdictionFor(cc, state?)` in same file |
| Per-jurisdiction notice templates | `docs/compliance/consent-notices/` (English baseline plus translations) |
| Cross-border transfer register | `docs/compliance/xborder.md` |
| Retention schedule | `docs/compliance/retention.md` |
| Breach runbook | `docs/compliance/breach-runbook.md` |
| AI Act FRIA | `docs/compliance/fria.md` |
| DPIA | `docs/compliance/dpia.md` |
| AI risk register | `docs/compliance/ai-risk-register.md` |

## Review cadence

Reviewed quarterly or on any material legislative change in any jurisdiction
listed, whichever is sooner. Drift between this matrix and
`packages/compliance/src/jurisdiction.ts` is itself a finding and treated as
a SEV-3 incident per the breach runbook.

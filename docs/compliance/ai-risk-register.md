# AI Risk Register

**Frameworks:** NIST AI RMF 1.0 (Govern, Map, Measure, Manage) and OWASP GenAI Top 10 (2025).
**Version:** 1.0.0
**Date:** 2026-04-15
**Owner:** DPO (Divya Mohan, dmj.one)

Likelihood and impact are Low, Medium, High, Critical. Inherent risk is L x I before controls; residual risk is after.

| Risk ID | Category | Description | Likelihood | Impact | Inherent | Controls | Residual | Owner | Review |
|---|---|---|---|---|---|---|---|---|---|
| R01 | OWASP LLM01 | Prompt injection via retrieved TSB or user-supplied text poisoning tool calls | High | High | High | Strict system vs retrieved channel separation; Markdown/HTML strip; deny-list; second Haiku verifier on privileged tools (`docs/research/security.md` §4) | Medium | Sec lead | Quarterly |
| R02 | OWASP LLM02 | Sensitive info disclosure in model output or logs | Medium | High | High | PII redaction middleware on all prompts and logs; unified error envelope with rid (`docs/research/security.md` §4) | Low | Sec lead | Quarterly |
| R03 | OWASP LLM03 | Supply chain: model provider outage or compromised SDK | Medium | High | High | Multi-provider fallback (Claude, Gemini); lockfile committed; Trivy + OSV-Scanner gate; Binary Authorization (`docs/research/security.md` §5) | Medium | Eng lead | Quarterly |
| R04 | OWASP LLM05 | Improper output handling: tool args hallucinated into wrong types | High | High | High | Zod schemas on every tool input (`packages/shared/src/autonomy.ts`, `packages/shared/src/schema/consent.ts`); verifier chain | Low | Eng lead | Quarterly |
| R05 | OWASP LLM06 | Excessive agency: rogue tool call outside scope | Medium | Critical | Critical | Per-specialist tool scope; signed `CommandGrant` required for any vehicle action; witness co-signature (`packages/shared/src/autonomy.ts`) | Medium | Sec lead | Monthly |
| R06 | OWASP LLM07 | System prompt leakage | Medium | Medium | Medium | Prompt split into trusted vs retrieved channels; leakage tests in CI; log sanitiser (`docs/research/security.md` §4) | Low | Sec lead | Quarterly |
| R07 | OWASP LLM08 | Vector and embedding weaknesses: retrieval poisoning of KG | Medium | High | High | Source allow-list + signed corpora + diff review (`docs/research/security.md` §7); embedding provenance logged | Low | Data lead | Quarterly |
| R08 | OWASP LLM09 | Misinformation: ungrounded diagnosis given to owner | High | High | High | Groundedness gate with citations; dual-cross-check safety pipeline (`packages/shared/src/safety.ts`); explanation drawer | Medium | AI lead | Quarterly |
| R09 | OWASP LLM10 | Unbounded consumption: cost blowout via loops | Medium | Medium | Medium | Per-session cost ceiling; per-IP rate limit at Cloud Armor; token budget per turn (`docs/research/security.md` §4) | Low | Eng lead | Quarterly |
| R10 | NIST MAP 1.1 | Context mapping drift as new OEMs onboard | Medium | Medium | Medium | OEM onboarding checklist; `AutonomyCapabilityContext` schema in `packages/shared/src/autonomy.ts`; capability resolver defaults fail-closed | Low | Product | Per onboarding |
| R11 | NIST MEASURE 2.5 | Bias drift across geography, vehicle age, gender | Medium | High | High | Weekly demographic-parity monitor, `<= 5 %` threshold alert (`docs/research/wellbeing.md` P10); independent fairness gate | Medium | AI lead | Weekly |
| R12 | NIST MANAGE 3.2 | Incident response lag on active exploit | Medium | Critical | Critical | 72 h breach runbook (`docs/compliance/breach-runbook.md`); on-call rota; automated pager; kill switch on feature flags | Low | SRE | Monthly drill |
| R13 | Autonomy | CommandGrant replay across vehicles or windows | Medium | Critical | Critical | `grantId` uuid, `notBefore`, `notAfter`, nonce, Merkle chain in `authority_log` (`packages/shared/src/autonomy.ts`) | Low | Sec lead | Monthly |
| R14 | Autonomy | Auto-pay cap bypass via forged quote | Low | Critical | High | Cap encoded inside signed grant; Razorpay or Stripe Payment Intent reserved hold; escalate-on-exceed (`docs/research/autonomy.md` §6) | Low | Payments | Monthly |
| R15 | Safety | Red-flag safety override bypass | Low | Critical | Critical | Hardcoded `SAFETY_RED_FLAGS` set, dual cross-check in `packages/shared/src/safety.ts`; deterministic post-check before commit | Low | Safety | Quarterly |
| R16 | SOTIF | Sensor vs fault misattribution, SOTIF false positive | Medium | High | High | Three-state arbitration in `packages/sensors/src/fusion.ts`; uncertainty-aware RUL lower bound for tier-1 decisions (`docs/research/prognostics.md` §3.3) | Medium | Safety | Quarterly |
| R17 | DPDP | Consent forgery or server-side flipping of `granted` | Low | High | Medium | Append-only `consent_log`; SHA-256 `evidenceHash` of notice shown (`packages/shared/src/schema/consent.ts`); WORM export for audit | Low | DPO | Quarterly |
| R18 | Crypto | CommandGrant signing-key compromise | Low | Critical | High | Owner key in WebAuthn passkey or hardware key; server witness key in Cloud KMS ML-DSA-65 with 30-day rotate; key revocation list; Binary Auth on signer image (`docs/research/security.md` §1, §5) | Low | Sec lead | Monthly |

## Change log

- 2026-04-15: Initial register.

## Review cadence summary

- Monthly: R05, R12, R13, R14, R18.
- Weekly: R11.
- Per onboarding: R10.
- Quarterly: all others.

## Notes

Every row must cite at least one source file; unsupported controls are not acceptable. Reviewers must verify at each cadence that the cited file still implements the stated control; drift is itself a finding.

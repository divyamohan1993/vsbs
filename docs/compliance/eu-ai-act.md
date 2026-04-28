# EU AI Act mapping — VSBS autonomous handoff and auto-pay

**Regulatory basis:** Regulation (EU) 2024/1689 of the European Parliament
and of the Council laying down harmonised rules on artificial intelligence
("EU AI Act"), in force 1 August 2024, with staged application: prohibitions
from 2 February 2025, GPAI obligations from 2 August 2025, the bulk of
high-risk and governance from 2 August 2026 (the date by which our pilot
must be conformant), and the rest from 2 August 2027.

**Version:** 1.0.0
**Date:** 2026-04-15
**Owner:** DPO + AI Act conformity officer (Divya Mohan, dmj.one)

## 1. Classification

VSBS includes AI components that are classified as **high-risk** under
Annex III, specifically because the autonomous handoff path (`CommandGrant`)
authorises driving manoeuvres, and the auto-pay path executes payments on
the user's behalf:

- **Annex III(2)(a)** — AI systems intended to be used as safety components
  in the management and operation of road traffic, or in the supply of
  water, gas, heating and electricity. The autonomous handoff is a safety
  component because it authorises another agent to operate the vehicle.
- **Annex III(5)(b)** — AI systems intended to be used to evaluate the
  creditworthiness of natural persons or to establish their credit score.
  Our auto-pay flow does not score creditworthiness. **Not in scope** here.
- The diagnostic recommendation is **not** in Annex III; it is governed by
  the GPAI provisions (Title V) and our voluntary code of conduct.

## 2. Article-by-article mapping

| AI Act article | Requirement | Where it lives in VSBS |
|---|---|---|
| Art. 9 | Risk management system across the lifecycle | `docs/compliance/ai-risk-register.md`, NIST AI RMF mapping in `packages/compliance/src/ai-risk-register.ts` |
| Art. 10 | Data and data governance: training, validation, and testing data quality and bias controls | `docs/research/wellbeing.md` §P10 (fairness gate), `docs/simulation-policy.md` (origin stamping) |
| Art. 11 | Technical documentation per Annex IV | This document plus `docs/architecture.md` plus `STACK.md` plus the research index `docs/research/*` |
| Art. 12 | Logging and traceability over the lifetime of the system | `ai_decision_log` (per booking), `authority_log` (per command grant), retention 7 years per `docs/compliance/retention.md` |
| Art. 13 | Transparency to the deployer | The explanation drawer on every recommendation, plus the user-facing notice templates in `docs/compliance/consent-notices/` |
| Art. 14 | Human oversight | UNECE R157 takeover ladder, owner override on every step, mandatory re-consent on notice version bumps, revocation within 10 s. See `packages/shared/src/takeover.ts` and `packages/shared/src/commandgrant-lifecycle.ts` |
| Art. 15 | Accuracy, robustness, cybersecurity | Uncertainty-aware RUL lower bound for safety-critical decisions, sensor arbitration, post-quantum hybrid envelope, ML-DSA-65 grant signing, Cloud Armor + reCAPTCHA Enterprise on auth and auto-pay |
| Art. 16 | Obligations of providers | We are the provider of the high-risk system. Conformity assessment per Annex VI route. CE-marking and EU declaration of conformity per Art. 47 |
| Art. 17 | Quality management system | `docs/compliance/quality-management.md` (to be filled at deployment) |
| Art. 19 | Automatically generated logs are kept by the provider | Authority log retained 7 years, AI decision log retained 3 years per the retention schedule |
| Art. 20 | Corrective actions | Kill switch on each agent and adapter; rollback in under 60 s; documented in the breach runbook |
| Art. 21 | Cooperation with competent authorities | DPO contact (`dpo@dmj.one`); regulator notification flow in `BreachReporter` (`packages/compliance/src/breach.ts`) |
| Art. 22 | Authorised representatives | To be designated per deployment; placeholder in `docs/compliance/contacts.md` |
| Art. 23 | Obligations of importers | Not applicable when the provider is established in the Union |
| Art. 24 | Obligations of distributors | Distributor diligence is documented in the SCC pack delivered to operators per `NOTICE` |
| Art. 25 | Responsibilities along the value chain | OEM adapters declare scope and limitations per the autonomy-registry contract |
| Art. 26 | Obligations of deployers | The deploying operator runs the FRIA (Art. 27), monitors operation, retains logs, and ensures human oversight. Mapping in `docs/compliance/fria.md` |
| Art. 27 | **Fundamental Rights Impact Assessment (FRIA)** | `docs/compliance/fria.md` (signed before first production use). Re-run on any material change |
| Art. 49 | Registration in the EU database | Operator registers the high-risk system before placing on market or putting into service |
| Art. 50 | Transparency obligations for certain AI systems (chatbot, deep fakes, emotion recognition) | The concierge identifies as an AI system on the first user-facing turn |
| Art. 71 | Post-market monitoring | Continuous metrics collection, weekly fairness review, monthly safety review per `docs/compliance/ai-risk-register.md` cadence |
| Art. 73 | Reporting of serious incidents | Integrated into the breach runbook; routes through DPO and the AI Act conformity officer |

## 3. Conformity assessment route

We follow **Annex VI** (internal control with the involvement of a notified
body when the provider has applied harmonised standards). The harmonised
standards we plan to follow once finalised:

- ISO/IEC 42001 — AI management systems.
- ISO/IEC 5259 family — data quality for analytics and machine learning.
- ISO/IEC 27001 — information security management.
- ISO/IEC 22989 and 23053 — AI concepts and framework.
- ISO/IEC 24029-2 — robustness assessment.

For elements not yet covered by a harmonised standard, we follow the
**common specifications** the Commission may adopt under Art. 41.

## 4. CE marking and EU declaration of conformity

The CE-marked artefact is the **VSBS autonomous handoff component**, which
includes the `CommandGrant` lifecycle, the takeover ladder, and the
auto-pay path. The EU declaration of conformity is filed at deployment and
referenced in `docs/compliance/declaration-of-conformity.md`.

## 5. Pre-launch gate

The system must pass every row in the FRIA go / no-go table before the
operator flips `AUTONOMY_ENABLED=true` on a production deployment, per
roadmap item 93. The gates are non-negotiable.

## 6. Review cadence

Reviewed every 6 months or on any material change to the autonomy or
auto-pay paths, whichever is sooner. Reviewed within 30 days of any
amendment to the EU AI Act or its implementing acts.

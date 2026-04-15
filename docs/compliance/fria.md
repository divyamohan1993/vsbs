# Fundamental Rights Impact Assessment (FRIA)

**System:** VSBS autonomous service advisor plus `CommandGrant` and auto-pay flow.
**Regulatory basis:** EU AI Act (Regulation (EU) 2024/1689) Art. 27. The autonomy handoff plus auto-pay places this feature in Annex III high-risk.
**Version:** 1.0.0
**Date:** 2026-04-15

## 1. System description

VSBS uses a LangGraph supervisor with Claude and Gemini specialists. Tools include intake, sensor fusion, diagnosis, dispatch, payment, and autonomy handoff. For vehicles and venues that qualify (`resolveAutonomyCapability` in `packages/shared/src/autonomy.ts`), the concierge mints a `CommandGrant` capability token. The token is owner-signed (WebAuthn or ML-DSA-65), time-bounded, geofence-bounded, scope-bounded, and carries an auto-pay cap. The target service centre may drive the vehicle to the bay, diagnose, repair, and return, all within the grant. Every action is appended to a Merkle-chained `authority_log`.

## 2. Deployer and affected populations

- **Deployer:** VSBS operator entity (to be filled per deployment).
- **Affected populations:** vehicle owners and household drivers, service-centre staff, other road users in the geofence, pedestrians in the AVP envelope, insurer counterparties.

## 3. Fundamental rights at stake

Mapped to the Charter of Fundamental Rights of the EU.

| Right | Charter Art. | Exposure |
|---|---|---|
| Human dignity | 1 | Vulnerable owners in distress acting on an AI recommendation |
| Non-discrimination | 21 | Dispatch bias across geography, age, gender |
| Consumer protection | 38 | Auto-pay cap, silent upsell, cost opacity |
| Property | 17 | Unauthorised movement or repair of the vehicle, auto-pay abuse |
| Right to an effective remedy | 47 | Ability to contest an automated decision and obtain redress |
| Private life and data | 7, 8 | Telemetry, voice, photo, location |
| Physical integrity | 3 | Red-flag bypass dispatching unsafe vehicle to the owner |

## 4. Risk identification and mitigations mapped to code

| Risk | Mitigation | Code reference |
|---|---|---|
| Unsafe dispatch to owner | Hardcoded `SAFETY_RED_FLAGS` double-checked | `packages/shared/src/safety.ts` |
| Rogue tool call, privilege escalation | Second Haiku verifier on any privileged tool, per-specialist scope | `docs/research/security.md` §4 |
| Consent drift | Re-consent mandatory on any notice version bump; SHA-256 evidence hash | `packages/shared/src/schema/consent.ts` |
| Revocation latency | Ping interval hardcoded, `<= 10 s` | `docs/research/autonomy.md` §5 |
| Discrimination drift | Demographic-parity monitor, weekly, `<= 5 %` | `docs/research/wellbeing.md` P10 |
| Auto-pay bypass | Cap encoded in signed grant, not server flag | `packages/shared/src/autonomy.ts` |
| Replay of grant | `notBefore`, `notAfter`, `grantId` uuid, Merkle chain | `CommandGrantSchema` |
| Geofence escape | `GeofenceSchema` capped at `AUTONOMY_MAX_GEOFENCE_METERS` | `packages/shared/src/autonomy.ts` |
| Opacity | Explanation drawer one-line reason plus detail | `docs/research/wellbeing.md` §3 |

## 5. Human oversight (Art. 14)

Explicit, non-optional oversight mechanisms:

1. **Owner override button on every AI decision**, one tap, per Lee and See calibrated trust. See `docs/research/wellbeing.md` §3 rule 4.
2. **Mandatory re-consent** whenever the consent notice version changes; enforced by `ConsentNoticeSchema.version`.
3. **Takeover ladder** per UNECE R157: attention prompt, warning, request-to-intervene, minimum-risk maneuver, over a bounded 10 s window. See `docs/research/prognostics.md` §4.
4. **Revocation** within 10 s at any time during a grant, per `docs/research/autonomy.md` §5.
5. **Red-flag short-circuit** that bypasses optimisation and dispatches a tow even against the owner's wishes, per `docs/research/wellbeing.md` §4.
6. **Escalation to manual approval** whenever a quote exceeds the auto-pay cap by any amount; no silent partial.

## 6. Transparency (Art. 13)

The explanation drawer shows, in the user's language:

- Which specialist made the recommendation and why in one line.
- Evidence used (sensors, DTCs, historical service) with citations where the evidence was retrieved text.
- Published weights of the wellbeing composite per `docs/research/wellbeing.md` §2.
- The exact `CommandGrant` scopes, time window, geofence, and auto-pay cap before signing.
- A link to the notice version and its SHA-256 hash recorded at consent time.
- A "Contest this decision" link routing to the complaint flow (§9).

## 7. Accuracy and robustness (Art. 15)

- **Uncertainty-aware RUL.** The autonomy agent consumes `(mu, sigma, source)` and acts on the lower bound (5th percentile) for safety-critical components, per `docs/research/prognostics.md` §3.3. No point estimates drive tier-1 decisions.
- **Sensor arbitration** distinguishes a broken sensor from a broken vehicle before any state reaches `critical` or `unsafe`, per `docs/research/prognostics.md` §5 and `packages/sensors/src/fusion.ts`.
- **Groundedness gate** requires citations on any user-facing factual claim, per `docs/research/security.md` §4.
- **Simulator-real isolation** via `origin` stamping in `packages/shared/src/sensors.ts`; simulated data cannot enter a real customer decision log.
- **Benchmarks** on NASA C-MAPSS, IMS bearings, and Li-ion data before deployment on real vehicles, per `docs/research/prognostics.md` §3.2.

## 8. Cybersecurity

- Post-quantum hybrid envelope (ML-KEM-768 plus X25519, AES-256-GCM DEK) on long-lived secrets.
- ML-DSA-65 code signing via Cloud KMS.
- Zero trust on GCP: BeyondCorp, IAP, VPC-SC, Binary Authorization, Workload Identity Federation, per `docs/research/security.md` §5.
- `CommandGrant` signed with WebAuthn or ML-DSA-65; witnesses co-sign.
- Threat model in `docs/research/security.md` §7.

## 9. Complaint mechanism (Art. 85)

- Email: `dpo@dmj.one`
- In-app form reachable from every explanation drawer, posted to `POST /v1/complaints`.
- Response SLA: acknowledgement within 24 h, substantive response within 15 days.
- All complaints logged in `complaints` collection with a complaint id and a right-of-appeal to the local supervisory authority.

## 10. Approval

| Approver | Title | Signature | Date |
|---|---|---|---|
| _pending_ | DPO | | |
| _pending_ | AI Act conformity officer | | |
| _pending_ | Exec sponsor | | |

## 11. Go / no-go table

| AI Act clause | Requirement | Pass | Fail |
|---|---|---|---|
| Art. 14(1) | Effective human oversight | x | |
| Art. 14(4)(a) | Understand capacities and limits | x | |
| Art. 14(4)(b) | Remain aware of automation bias | x | |
| Art. 14(4)(c) | Correctly interpret output | x | |
| Art. 14(4)(d) | Decide not to use, override, reverse | x | |
| Art. 14(4)(e) | Intervene or interrupt via stop button | x | |
| Art. 15(1) | Accuracy, robustness, cybersecurity | x | |
| Art. 15(3) | Resilience to errors and inconsistencies | x | |
| Art. 15(4) | Resilience to attempts to alter use | x | |
| Art. 15(5) | Cybersecurity level appropriate to risk | x | |

Review cadence: 6 months or on any material change to tiered autonomy behaviour, whichever is sooner.

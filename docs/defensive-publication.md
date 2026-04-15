# Defensive Publication — VSBS Autonomous Vehicle Service Booking System

**Author and inventor:** Divya Mohan (dmj.one) <contact@dmj.one>
**Date of public disclosure:** 2026-04-15
**Repository:** the source tree containing this file, licensed under Apache License 2.0.
**License notice:** Apache 2.0, see [LICENSE](../LICENSE) and [NOTICE](../NOTICE).

## Purpose of this document

This is a **defensive publication** under the doctrine recognised by the United States Patent and Trademark Office (USPTO) Manual of Patent Examining Procedure MPEP §2128 ("References available to the public"), Article 54 of the European Patent Convention (EPC), and Section 13 of the Indian Patents Act 1970. Its purpose is to place the inventive concepts described in this repository into the public domain as prior art as of the date above, so that no later-filed patent can validly claim exclusive rights over these concepts against the author or any downstream user of this work.

The author does **not** abandon copyright; the work remains under Apache 2.0. The author does **not** grant any new rights beyond Apache 2.0. The purpose is solely to establish unambiguous, dated prior art.

## Inventive concepts disclosed

The following concepts are, individually and in any combination, disclosed publicly as of the date above and are therefore prior art against any later patent filing anywhere in the world. URLs and file paths in this repository are the authoritative reference.

### 1. Tiered autonomous vehicle service orchestration with signed, time-bounded command-authority capability tokens
A system in which a vehicle owner, through a mobile or web application, mints a cryptographically signed, time-bounded, geofence-bounded, scope-bounded capability token ("CommandGrant") that authorises a service centre to operate the vehicle autonomously for a defined set of scopes (diagnose, drive-to-bay, repair, test-drive, drive-home) within a defined operational design domain, where the token is co-signed by a concierge agent and optionally an insurer, where every action taken under the token is appended to a cryptographically chained audit log, and where revocation is honoured within a bounded revocation ping interval. See [packages/shared/src/autonomy.ts](../packages/shared/src/autonomy.ts), [docs/research/autonomy.md](research/autonomy.md).

### 2. Tier-aware autonomy capability resolution across heterogeneous OEM autonomy levels
A capability resolver that, given a vehicle identity, destination provider, and owner/insurance state, returns the highest applicable SAE / OEM autonomy tier (from `A-SUMMON`, `A-AVP`, `B-L3-HIGHWAY`, `B-L4-ROBOTAXI`, `C-ROADMAP`) for a specific trip, conservatively defaulting to a human pickup path when any gate fails. See [packages/shared/src/autonomy.ts](../packages/shared/src/autonomy.ts).

### 3. Safety-first dispatch objective with wellbeing dominance
A dispatch optimisation that evaluates candidate service modes ({drive-in, mobile, pickup-drop, tow, autonomous-tier-A}) against a weighted objective where customer wellbeing has the largest single weight, travel time, wait time, load balance, cost, and historical service satisfaction are additively weighted, and a red-flag severity pre-filter short-circuits the optimisation to a non-overridable tow. See [docs/research/dispatch.md](research/dispatch.md) §3 and [packages/shared/src/constants.ts](../packages/shared/src/constants.ts).

### 4. Composite customer wellbeing score with safety gating
A pure-function composite score over ten normalised sub-scores — safety, Maister-aligned wait, cost transparency index, time accuracy, auto-SERVQUAL, trust in AI advisor, mobility continuity, customer effort, CSAT, NPS — with published weights anchored to peer-reviewed literature, and an independent demographic-fairness gate that escalates at system level rather than contributing to the per-booking score. See [packages/shared/src/wellbeing.ts](../packages/shared/src/wellbeing.ts) and [docs/research/wellbeing.md](research/wellbeing.md).

### 5. Dual-cross-check safety red-flag enforcement
A two-pass safety assessment pipeline in which a primary assessment is recomputed by an independent post-check before any commit that would authorise a customer to drive a potentially unsafe vehicle, and disagreement between the two passes is treated as fail-closed, aborting the commit. See [packages/shared/src/safety.ts](../packages/shared/src/safety.ts).

### 6. Tiered prognostic health state machine with sensor-failure arbitration
A five-state prognostic health state machine (`healthy → watch → act-soon → critical → unsafe`) applied per component, where component criticality tiers are derived from ISO 26262 ASIL mappings, uncertainty-aware remaining-useful-life estimates are consumed at their lower confidence bound for safety decisions, and a cross-modal arbitration step distinguishes a confirmed vehicle fault from a suspected sensor failure before any state transition into `critical` or `unsafe`. See [packages/shared/src/phm.ts](../packages/shared/src/phm.ts), [packages/sensors/src/fusion.ts](../packages/sensors/src/fusion.ts), [docs/research/prognostics.md](research/prognostics.md).

### 7. Graceful-degradation driver-takeover ladder under SOTIF
An escalation ladder triggered when a tier-1 safety-critical component enters `critical` or `unsafe` state while the vehicle is under autonomous authority, coordinating tactile + auditory + visual + haptic channels, progressing from attention prompt through request-to-intervene to minimum-risk maneuver over a bounded window, and refusing any further autonomous operation with a fallback that asks the owner to drive manually under the system's live guidance or to request a tow. See [docs/research/prognostics.md](research/prognostics.md) §4.

### 8. Autonomous auto-pay within a user-set cap, cryptographically bound to the capability token
An auto-pay mechanism in which the per-service cap is encoded inside the `CommandGrant` token, not as a server-only flag, so that a service centre cannot charge more than the token allows even if the server is compromised; where any quote exceeding the cap escalates the entire transaction to manual approval without silent partial payment; and where a bounded cool-off window allows the owner to reverse an auto-paid transaction without manual approval. See [packages/shared/src/autonomy.ts](../packages/shared/src/autonomy.ts).

### 9. Sensor provenance stamping with simulator-real isolation
Every sensor sample in the system carries an `origin` tag that is either `real` or `sim`; the fusion layer emits a provenance summary on every observation; simulated samples are structurally prevented from entering a real customer's decision log. This is disclosed as a method for training, testing, and operating autonomous systems without risking the customer-facing pipeline confusing simulated data for real data. See [packages/shared/src/sensors.ts](../packages/shared/src/sensors.ts).

### 10. Exact-production-logic simulation with single-toggle promotion
A simulation discipline in which every simulated external dependency (payments, SMS, maps, connected-car, autonomy hand-off) implements the **identical** state machine as its production counterpart and is promoted to production by flipping a single runtime toggle, with no behavioural difference between simulation and production modes. See [docs/simulation-policy.md](simulation-policy.md).

### 11. Per-purpose DPDP-native consent with evidence hash
An append-only, per-purpose, per-version consent log where every record carries a SHA-256 hash of the notice the user actually saw at the time of consent, so that consent authenticity can be proven years later even if the notice text drifts. See [packages/shared/src/schema/consent.ts](../packages/shared/src/schema/consent.ts).

### 12. Exhaustive intake capture schema for autonomous vehicle service, covering owner identity, vehicle identity (VIN with ISO 3779 check digit or Indian RC plate), powertrain, ownership, service history, compliance documents, tyres, brakes, multilingual symptoms, warning lights under ISO 2575, OBD capture (J1979 modes $01, $02, $03, $06, $07, $09, $0A including freeze frame and readiness monitors), recent repairs, aftermarket modifications, logistics preferences, and DPDP-native consent. See [packages/shared/src/schema/intake.ts](../packages/shared/src/schema/intake.ts).

## Declaration

I, Divya Mohan, being the original author of the work above, hereby publish the inventive concepts described in this document and in the referenced files, as of the date above, for the purpose of establishing prior art. I make no claim to patent rights over the concepts disclosed and do not intend to file any patent covering them. I rely on copyright under Apache License 2.0, including the NOTICE preservation requirement of Section 4(d), and on prior-art protection under applicable patent law.

Any later filer whose claims read on the disclosed concepts is on notice that this publication constitutes prior art under 35 U.S.C. §102, Article 54 EPC, Section 13 Indian Patents Act 1970, and equivalent provisions worldwide.

**Divya Mohan**
**dmj.one**
**2026-04-15**

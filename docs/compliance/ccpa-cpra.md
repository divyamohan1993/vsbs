# CCPA + CPRA notice — California residents

**Version:** 1.0.0
**Date:** 2026-04-15
**Operator:** VSBS operator entity (to be filled per deployment)
**Contact:** privacy@vsbs.app, postal address per deployment, DPO `dpo@dmj.one`

This notice supplements the global Privacy Policy and is the **Notice at
Collection** required by Cal. Civ. Code §1798.100(b) and §1798.130(a)(5).
Where this notice and the global policy conflict for a California resident,
this notice prevails for that resident.

## 1. Categories of Personal Information we collect

We collect, in the past 12 months and on an ongoing basis, the following
categories of Personal Information defined in Cal. Civ. Code §1798.140(v):

| CCPA category | What we collect for VSBS | Source | Purpose |
|---|---|---|---|
| Identifiers | Name, phone, email, account id, IP address (hashed at rest), device id | You; the app | Service fulfilment, fraud prevention |
| Commercial information | Booking history, transaction records, parts purchased | Your bookings | Service fulfilment, accounting |
| Geolocation data | Vehicle GPS while a service is active or under autonomy grant | Vehicle | Routing, autonomous handoff |
| Sensory data | Voice clips, photos uploaded during intake | You | Diagnosis |
| Internet or other electronic activity | Pages viewed, features used, session metadata | App telemetry | Product analytics, security |
| Vehicle data | OBD-II DTCs, telemetry, sensor readings | Vehicle | Diagnosis, prognostics |
| Inferences | Diagnostic ranking, wellbeing score, autonomy eligibility | Derived | Recommendations |
| Sensitive Personal Information (SPI) | Precise geolocation, government identifiers (RC, VIN), payment instrument, voice/photo when used for diagnosis | You and the vehicle | Service fulfilment, payment, autonomy |

## 2. Purposes of processing

We use the above only for the disclosed business purposes per Cal. Civ. Code
§1798.140(e):

1. Performing the service requested by you (the booking).
2. Providing customer service and processing payments.
3. Detecting security incidents, debugging, and short-term transient use.
4. Quality and safety of the service, including the safety invariants
   coded in `packages/shared/src/safety.ts`.
5. Auditing related to a current interaction.
6. Internal research and development of new features, only where you opt
   in to `ml-improvement-anonymised`.

## 3. Sale or sharing

**We do not sell Personal Information**, and we do not share Personal
Information for cross-context behavioural advertising as defined in CPRA
§1798.140(ah). Therefore, the "Do Not Sell or Share My Personal Information"
link is provided for clarity but the underlying processing it would target
does not exist. The link still operates as the universal opt-out for any
future change in this posture.

## 4. Use of Sensitive Personal Information

We use SPI strictly for the purposes that are necessary to provide the
service you requested, as permitted by CPRA §1798.121(a). You may use the
**"Limit the Use of My Sensitive Personal Information"** link to instruct
us to limit our use of SPI to those necessary purposes only.

We do not use SPI for inferring characteristics about you.

## 5. Retention

Retention follows the schedule in `docs/compliance/retention.md` and is
expressed per purpose. We do not retain SPI longer than necessary for the
disclosed purpose.

## 6. Your rights

California residents have the following rights under CCPA + CPRA:

| Right | Statute | How to exercise |
|---|---|---|
| Know | §1798.110 | `GET /v1/me/data-export` or contact privacy@vsbs.app |
| Delete | §1798.105 | `POST /v1/me/erasure` or contact privacy@vsbs.app |
| Correct | §1798.106 | `POST /v1/me/correction` (when your account is used) or contact privacy@vsbs.app |
| Opt out of sale/share | §1798.120 | "Do Not Sell or Share My Personal Information" link in app footer |
| Limit Use of SPI | §1798.121 | "Limit the Use of My Sensitive Personal Information" link in app footer |
| Non-discrimination | §1798.125 | Automatic. We never lower service quality because you exercised a right |

We acknowledge requests within 10 business days and respond within 45 days,
extendable once by 45 days with notice, per §1798.130.

## 7. Authorised agent

You may use an authorised agent to submit a request. We require the agent
to provide written permission from you and verify your identity directly
with us, per §1798.135 and 11 CCR §7063.

## 8. Children

We do not knowingly process the Personal Information of California
residents under the age of 16 for the purpose of selling or sharing without
the affirmative authorisation required by §1798.120(c). Account creation
requires age confirmation.

## 9. Metrics

Per 11 CCR §7102, we will publish, when our headcount or processing volume
crosses the threshold, the number of requests received, complied with,
denied, and the median response time for each request type. Until that
threshold, we publish on request.

## 10. Contact

| Channel | Address |
|---|---|
| Email | privacy@vsbs.app |
| Postal | Operator entity, to be filled per deployment |
| DPO | Divya Mohan, `dpo@dmj.one` |
| Toll-free | To be filled per deployment if California operations exceed the threshold for §1798.130(a)(1)(A) |

## 11. Changes to this notice

We will update this notice on each material change and bump the version
above. The current version SHA-256 is recorded in our consent log when a
California resident accepts it; older versions remain available on request.

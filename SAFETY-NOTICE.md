# SAFETY NOTICE — Read Before You Deploy

**This is the load-bearing legal and safety statement for VSBS. It overrides any contrary statement, marketing copy, or implication anywhere else in this repository, including the README, the NOTICE, and any document under `docs/`.**

---

## 1. What VSBS is

VSBS is a **research-grade, open-source reference architecture and educational artefact** for an autonomous vehicle-service booking experience. It composes:

- a booking + concierge agent topology,
- a sensor-fusion and prognostic-health-management (PHM) **advisory engine**,
- a CommandGrant **capability protocol** for delegating motion authority,
- a defense-in-depth API and web shell,
- a DPDP/GDPR/CCPA-aware compliance pack and admin SIEM,
- adapter shells for OEM autonomy programmes (Mercedes/Bosch IPP, others),
- a deterministic simulator that allows the entire stack to be exercised without external dependencies.

Every architectural decision is traceable to peer-reviewed research, an international standard, or a vendor document. The corpus lives at [`docs/research/`](docs/research/).

## 2. What VSBS is NOT

VSBS is **NOT**, and is not held out to be, any of the following:

- A type-approved automotive product.
- A certified safety-of-life or safety-related system.
- A driving-automation system. It does not steer, brake, or accelerate any vehicle.
- A substitute for OEM functional-safety engineering, hazard analysis, or independent assessment.
- A regulator-approved or insurer-approved product.
- A finished product. It is a starting point.

## 3. Prohibited uses

You **MUST NOT** deploy VSBS, in whole or in part, in any of the following ways:

1. As a primary safety-control loop on a real vehicle.
2. As an authority over actuators (brakes, steering, throttle, transmission) on a moving vehicle.
3. On a public road, or in any environment shared with members of the public, where its failure could cause physical harm or death.
4. In a commercial product without independent completion of every certification, validation, and underwriting gate listed in §5 below.
5. In a way that misrepresents the research-citation trail as regulator approval or as a certified safety case.
6. With this `SAFETY-NOTICE.md` removed, modified to weaken the warning, or hidden from end users and operators.

## 4. Permitted uses

The following uses are permitted and welcome, subject to the Apache 2.0 licence and to this notice remaining intact:

1. **Research and teaching** — academic, lab, and classroom use.
2. **Prior-art reference** — for patent-defensive purposes, see [`docs/defensive-publication.md`](docs/defensive-publication.md).
3. **Advisory-only dashboards** — surfacing PHM, booking, status, and concierge information to a human, with **no actuator authority** and no claim of regulator approval.
4. **Back-office booking and concierge** — workshop CRM, dispatch, scheduling, payments, consent management.
5. **Simulation and internal evaluation** — running the full stack against the deterministic simulator with `origin: sim` data clearly stamped.
6. **Foundation for a multi-year regulated-engineering programme** — fork it, complete the gates in §5, and build a real product on top.

## 5. Mandatory gates before any safety-loop deployment

If you intend to push VSBS-derived code anywhere near a real vehicle's safety loop, you must independently complete, document, and have independently assessed at least the following. None of these are completed in this repository.

### Functional safety and assurance

| Gate | Standard / scheme |
|---|---|
| Functional safety case for every safety-related function | **ISO 26262** (ASIL-D for brakes/steering, ASIL-C/D for ADAS) |
| Safety of the Intended Functionality validation campaign | **ISO 21448 (SOTIF)** |
| Cybersecurity engineering and TARA against the OEM E/E architecture | **ISO/SAE 21434** |
| Cybersecurity Management System certification | **UNECE R155** |
| Software Update Management System certification | **UNECE R156** |
| Type approval for any automated motion mode (or regional equivalent) | **UNECE R157** (ALKS) |
| Process maturity assessment | **Automotive SPICE / VDA** |
| Independent third-party safety assessor sign-off | **TÜV / DEKRA / UL DQS / Intertek** |
| Underwritten product-liability and product-recall insurance | underwriter sign-off |

### Heavy commercial vehicle and fleet additions

| Gate | Why |
|---|---|
| Heavy-duty CAN diagnostic stack | **SAE J1939** (the in-repo OBD-II stack speaks SAE J1979 / light-duty only) |
| Air-brake systems | **ECE R13**, **FMVSS 121** |
| Advanced emergency braking for HCV | **EU 2021/1958**, **UN R131** |
| Hours-of-service / electronic logging | **FMCSA Part 395**, **AETR / EU 561/2006**, **AIS-140** (India) |
| Tachograph integration | **EU 165/2014** |
| Daily vehicle inspection report | **DOT Part 396** |

### Privacy and data protection

| Gate | Standard / law |
|---|---|
| Data Protection Impact Assessment | **DPDP Rules 2025** §S, **GDPR Art. 35** |
| Fundamental Rights Impact Assessment | **EU AI Act Art. 27** |
| Country-of-operation regulator notification | **MoRTH / KBA / NHTSA / FMCSA**, as applicable |
| Data residency, retention, and erasure controls | **DPDP 2023**, **GDPR**, **CCPA / CPRA** |

## 6. Liability allocation (binding on any deployer)

By cloning, building, deploying, redistributing, integrating, or otherwise using VSBS, the deployer agrees that:

1. **The deployer alone owns** the deployment, the safety case, the cybersecurity case, the regulatory approvals, the insurance, the operator training, the incident response, and the public communication.
2. **The original author does not warrant** that VSBS is fit for any particular purpose, certified for any safety-related use, free of defects, or compliant with any law in any jurisdiction. This is a restatement of Apache 2.0 §7 ("Disclaimer of Warranty"), to remove any doubt.
3. **The original author shall not be liable** for any direct, indirect, incidental, special, exemplary, or consequential damages, including but not limited to loss of life, personal injury, property damage, regulatory sanction, or business loss, arising from the use of, modification to, or inability to use VSBS, even if advised of the possibility of such damage. This is a restatement of Apache 2.0 §8 ("Limitation of Liability"), to remove any doubt.
4. **No statement** in the README, the NOTICE, the research corpus, the citations, the badges, the marketing, the social media, or any author communication shall be construed as a warranty, a representation of fitness, a regulatory clearance, or a substitute for the deployer's independent due diligence and certification work.

## 7. Mandatory disclosure when you redistribute

If you redistribute VSBS or any Derivative Work, in source or binary form, you must:

1. Preserve this `SAFETY-NOTICE.md` unchanged.
2. Preserve the warning banner at the top of `README.md` unchanged.
3. Preserve the `LICENSE` and `NOTICE` files unchanged, per Apache 2.0 §4(d).
4. Add your own deployment-specific safety case, DPIA, FRIA, and regulator notifications. None of these transfer with the code.

## 8. Reporting safety-relevant defects

If you discover a defect in VSBS that could lead to a safety-relevant misbehaviour in any reasonable deployment scenario, please report it privately per [`SECURITY.md`](SECURITY.md) and `contact@dmj.one`. Do not publish a public proof of concept until a fix is available. Coordinated disclosure timelines are listed in `SECURITY.md`.

## 9. Plain-English summary

> **VSBS is a serious research artefact, not a finished safety product. You are welcome to learn from it, build on it, and use the advisory and back-office layers. You are not welcome to put it in charge of a moving vehicle. If you do, every consequence is yours, and the original author has neither the warranty nor the liability for it.**

---

Copyright © 2026 Divya Mohan ([dmj.one](https://dmj.one)) · `contact@dmj.one`

Apache 2.0 licensed. This notice is supplemental to and not a modification of the Apache 2.0 licence; it operates as the deployer's binding acknowledgement under §§7-8.

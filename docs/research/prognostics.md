# Research: Prognostic Health Management (PHM) + Graceful Takeover

> Goal: the car knows the **probabilistic health** of every safety-critical component in real time, predicts remaining useful life (RUL), warns the driver before failure, and — if a road-safety-critical sensor has actually died — refuses autonomous operation and tells the owner to drive manually to the repair shop.

## 1. Why PHM (and not only reactive diagnostics)

Reactive diagnostics (OBD DTCs, warning lights) flag failures **after** they happen. A system that is trusted to autonomously drive a car to service must also **predict** failures **before** they happen. This is the domain of **Prognostic Health Management (PHM)**, a discipline with a 20-year body of work in aerospace, rotating machinery, and increasingly automotive.

- **IEEE PHM Society** — community and benchmarks ([phmsociety.org](https://www.phmsociety.org/)).
- **ISO 13374** — the international standard that partitions a PHM system into a clean pipeline of six functional blocks: Data Acquisition → Data Manipulation → State Detection → Health Assessment → Prognostic Assessment → Advisory Generation ([ISO 13374-1 overview / ResearchGate figure](https://www.researchgate.net/figure/SO-13374-condition-monitoring-standard_fig1_299697785)). Our subsystem mirrors these six stages exactly.
- **ISO 17359** — general guidelines for condition monitoring and diagnostics of machines.
- **ISO 21448 (SOTIF)** — the automotive standard for "safety of the intended functionality": hazards that occur **even when the system works as designed** — sensor misinterpretations, insufficient perception, AI limitations. SOTIF is the complement to ISO 26262 and is exactly the lens we need for "what if the perception kit is technically working but is about to fail, or has a false-positive?" ([ISO 21448:2022 page](https://www.iso.org/standard/77490.html), [SOTIF guide PDF](https://www.lhpes.com/hubfs/LSS-eBook-PDF-The-Guide-to-SOTIF-ISO-21448.pdf), [PTC ISO 26262 vs SOTIF](https://www.ptc.com/en/blogs/alm/iso-26262-vs-sotif-iso-pas-21448-whats-the-difference)).
- **ISO 26262** — functional safety for E/E systems (ASIL classifications). Our critical components are mapped to ASIL ratings from the standard.

## 2. Component criticality table

These are the components whose health is continuously monitored. Each one has a criticality tier; tier-1 are **road-safety-critical** — if they fail, the car is not safe to drive, autonomously or manually.

| Component | Tier | ISO 26262 ASIL (typical) | Failure mode | Primary indicator |
|---|---|---|---|---|
| Service brakes + ABS | 1 | D | Loss of brake force / fluid leak / pad ≤ 10 % | Brake-pressure sensor, pad-wear sensor, ABS DTCs |
| Steering (EPS / rack) | 1 | D | Loss of assist, binding | Torque sensor, motor current, steering-angle variance |
| Tires | 1 | C | Slow leak, tread end-of-life, heat rise | TPMS pressure + temperature, tread-depth (user capture), DOT age |
| Airbag + SRS | 1 | D | Crash-sensor fault, deployed | SRS DTCs |
| Front camera (ADAS) | 1 (for autonomous) | C | Fogging, blinding, hardware failure | Image-quality score, fps drop |
| Radar (front, corner) | 1 (for autonomous) | C | Blockage, calibration drift | Track density, self-calibration residual |
| LiDAR | 1 (for autonomous) | C | Dirt, laser degradation | Return rate, echo variance |
| Ultrasonics | 2 | B | Blockage | Self-test |
| IMU | 2 (higher for autonomous) | B | Bias drift | Kalman residual |
| Battery 12V SLI / LV | 2 | B | Capacity fade, CCA drop | Cranking voltage, resting V, age |
| HV traction battery | 1 (EV) | D | Thermal runaway risk, cell imbalance | Cell V spread, dT/dt, SoH, IR rise |
| Alternator / DC-DC | 2 | B | Failure → battery drain | Charging voltage under load |
| Engine oil / cooling | 2 | B | Pressure drop, overheat | Oil-pressure sensor, coolant temp |
| Fuel / fuel pump | 2 | B | Starvation | Rail pressure |
| Transmission | 2 | B | Slip / shudder / pressure | Line pressure, slip ratio |
| Suspension dampers | 3 | A | Blown damper | Ride-height variance, road noise |
| Drive belt / chain | 2 | B | Stretch / breakage | Belt-tensioner position |
| Wheel bearings | 2 | B | Bearing wear | Vibration spectrum, wheel-speed noise |
| Exhaust / emissions | 3 | A | O2/NOx/DPF | O2 sensor, DPF ΔP |

## 3. RUL estimation methods (grounded, with citations)

We use an **ensemble** that is transparent about its assumptions. No single opaque model.

### 3.1 Physics-of-failure models for well-understood components

- **Brake pad wear** — linear model with re-calibration on inspection: `remaining_mm = (current_mm) / wear_rate_mm_per_km × km_left`. Wear rate is re-estimated with a Kalman filter as new inspection data arrives.
- **Tire tread end-of-life** — hydroplaning risk rises sharply below 3 mm per the UK Tyre Industry Federation / NHTSA and many insurance guidelines; legal minimum 1.6 mm in India and EU. Linear wear model anchored on inspection.
- **Tire age** — NHTSA guidance: tyres should be replaced at 6–10 years regardless of tread ([NHTSA Tire Aging](https://www.nhtsa.gov/equipment/tires)).
- **12 V battery RUL** — classical rule-of-thumb: SLI battery life 3–5 years; combined with CCA trend and resting V for a state-space model.
- **HV battery SoH** — empirical capacity-fade and IR-rise curves per chemistry (NMC, LFP, NCA), calibrated at every rapid-charge session. References: [Xu et al. 2023 "Data-driven health estimation of lithium-ion batteries", *Nature Energy*](https://doi.org/10.1038/s41560-023-01224-9); [Severson et al. 2019 *Nature Energy* 4, 383](https://doi.org/10.1038/s41560-019-0356-8).

### 3.2 Data-driven RUL for complex components

We benchmark our pipeline on NASA's public PHM datasets (Turbofan C-MAPSS, Bearings IMS, Li-ion) before using it on real car data — this is the field's standard practice:

- **NASA C-MAPSS turbofan** — the canonical RUL benchmark. Latest 2024–2025 deep-learning work:
  - [Nature Scientific Reports 2025 — deep-learning prognostic approach](https://www.nature.com/articles/s41598-025-09155-z) — hybrid CNN-LSTM with attention.
  - [arXiv 2511.19124 — Uncertainty-aware framework with learned aleatoric uncertainty](https://arxiv.org/html/2511.19124v1) — gives us a principled σ alongside every RUL estimate.
  - [PMC10857698 — Two-stage hierarchical transformer](https://pmc.ncbi.nlm.nih.gov/articles/PMC10857698/) — SOTA transformer baseline.
- **NASA PCoE data set repository** — bearings, batteries, IGBTs, turbofan ([NASA PCoE](https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/pcoe/pcoe-data-set-repository/)).
- **Saxena et al. 2008** — the original C-MAPSS paper, "Damage Propagation Modeling for Aircraft Engine Run-to-Failure Simulation," which is still the reference for the benchmark ([IEEE PHM 2008](https://ieeexplore.ieee.org/document/4711414)).

### 3.3 Uncertainty quantification (non-negotiable for safety)

We do **not** ship point estimates. Every RUL comes with a confidence interval and a source hint (which model, which data, which assumptions). Uncertainty-aware RUL is an active subfield ([arXiv 2511.19124](https://arxiv.org/html/2511.19124v1)). The consumer of the RUL (the autonomy agent) consumes `(mu, sigma, source)` and bases its action on the **lower bound** for safety-critical components ("worst plausible", 5th percentile).

## 4. From RUL to action — graceful degradation (SOTIF-aligned)

This is the operational translation of RUL into user-visible behaviour.

```
state = (health, confidence)
```

| State | Definition | System action |
|---|---|---|
| **Healthy** | P(fail in next 1000 km) < 1 % | Silent. |
| **Watch** | 1 % ≤ P(fail in next 1000 km) < 10 % | Gentle reminder at next app open; auto-book a preventive inspection if owner opted in. |
| **Act-soon** | 10 % ≤ P(fail in next 500 km) < 30 % | In-app + voice alert next trip start; propose booking now. |
| **Critical** | P(fail in next 100 km) ≥ 30 % and component **not** tier-1 | Amber push; refuse autonomous-drive tier A; propose mobile mechanic. |
| **Unsafe** | Any tier-1 component in critical OR a confirmed tier-1 fault | **Immediate alert: driver focus / take over** if in motion; **refuse all autonomous operation**; if not in motion, instruct the owner to **drive manually (carefully) to the repair shop** OR request a tow if the owner is uncomfortable. |

**Driver-takeover alert** (when in motion and system has autonomous authority):
- Multi-modal: tactile (seat-rumble pattern where supported), auditory chime, voice announcement ("Takeover required in five seconds — brake assist signal degrading"), visual red-band in cluster/phone-mirror, haptic through steering.
- Escalation ladder over 10 s: attention → warning → request-to-intervene → minimum-risk maneuver (signalled pull-over + hazard lights + brake).
- If the driver does not respond, and we retain autonomous authority, we invoke the **minimum-risk maneuver** (MRM) per the SOTIF / UNECE R157 convention: signal, decelerate smoothly in-lane, activate hazards, stop, call for help.

**Sensor-failure case** (tier-1 perception or actuation sensor dead):
- Autonomous drive to SC is **refused** even if other conditions allow.
- Explanation to owner: *"The forward camera has failed — I cannot see reliably. Please drive the car manually to our nearest center, 6.2 km. I will guide you, track your trip, and pre-notify the technician."*
- If manual driving itself is unsafe (brakes, steering, HV battery thermal) → tow.

## 5. Sensor health vs vehicle health arbitration

Critical: we must not confuse a **broken sensor** with a **broken vehicle** (ISO 21448 SOTIF territory). The arbitration table:

| Primary sensor says | Independent evidence | Verdict |
|---|---|---|
| Brake warning red | Brake-pressure residual abnormal | Confirmed tier-1 fault |
| Brake warning red | Brake-pressure residual normal + pad-wear signal normal + no DTC | **Suspected sensor failure**, raise sensor-health ticket, drive allowed but not autonomous |
| Front camera fps = 0 | Rain/fog on windshield + recent wash? | Likely environmental → ask to clean |
| Front camera fps = 0 | Clean + other sensors nominal | **Sensor failure**, autonomy refused |
| HV battery SoH < 70 % | Consistent over last 20 charges | Confirmed degradation |
| HV battery SoH < 70 % | Jumps from 90 % in one session | **Suspected BMS sensor fault**, flag not degrade |

Arbitration runs through the fusion stage in [`packages/sensors/src/fusion.ts`](../../packages/sensors/src/fusion.ts) and is mandatory before any state transitions to `Critical` or `Unsafe`.

## 6. Continuous learning and calibration

- Every inspection performed at a real service center is a **labelled data point** that re-calibrates the model for that vehicle + trim + region.
- We do not update user-specific models on-device without consent; aggregate model updates are federated or DP-aggregated (per DPDP + GDPR).
- Model versioning + rollback are tracked in `ai_decision_log`.

## Sources

- [ISO 13374-1 overview](https://www.researchgate.net/figure/SO-13374-condition-monitoring-standard_fig1_299697785)
- [ISO 21448:2022 (SOTIF)](https://www.iso.org/standard/77490.html)
- [SOTIF 2023 guide PDF](https://www.lhpes.com/hubfs/LSS-eBook-PDF-The-Guide-to-SOTIF-ISO-21448.pdf)
- [PTC — ISO 26262 vs SOTIF](https://www.ptc.com/en/blogs/alm/iso-26262-vs-sotif-iso-pas-21448-whats-the-difference)
- [IEEE PHM Society](https://www.phmsociety.org/)
- [NASA PCoE Data set repository](https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/pcoe/pcoe-data-set-repository/)
- [Saxena et al. 2008 — Damage Propagation Modeling, IEEE PHM](https://ieeexplore.ieee.org/document/4711414)
- [Nature Sci Rep 2025 — deep learning prognostic](https://www.nature.com/articles/s41598-025-09155-z)
- [arXiv 2511.19124 — Uncertainty-aware RUL](https://arxiv.org/html/2511.19124v1)
- [PMC10857698 — Hierarchical Transformer for RUL](https://pmc.ncbi.nlm.nih.gov/articles/PMC10857698/)
- [Xu et al. 2023 Nature Energy, Li-ion health](https://doi.org/10.1038/s41560-023-01224-9)
- [Severson et al. 2019 Nature Energy](https://doi.org/10.1038/s41560-019-0356-8)
- [NHTSA Tire Aging](https://www.nhtsa.gov/equipment/tires)
- [UNECE R157 — Automated Lane Keeping Systems (MRM)](https://unece.org/transport/documents/2021/03/standards/un-regulation-no-157-automated-lane-keeping-systems-alks)

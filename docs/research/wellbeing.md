# Research: Customer Wellbeing Composite Score

> Goal: treat customer safety, stress, trust, and convenience as first-class optimisation objectives — not a cosmetic afterthought. Every parameter is anchored in a peer-reviewed or authoritative source.

## 1. Parameters

| # | Parameter | Definition source | How we measure it |
|---|---|---|---|
| P1 | **Driving-under-fault stress** | NHTSA *"Driver Distraction and Drowsiness"* program ([NHTSA](https://www.nhtsa.gov/behavioral-research)); Horswill & McKenna, *Driver Risk Perception*, 2004 | Proxy: `distance_to_SC_km` × `symptom_severity_factor`. If severity = red or ≥ 25 km, set to max. |
| P2 | **Service quality expectation gap** | **SERVQUAL** — Parasuraman, Zeithaml, Berry, *J. Retailing* 1988 ([DOI](https://doi.org/10.2307/1251430)); **AutoSERVQUAL** specialisation — Izogo & Ogba, *IJQRM* 2015 ([DOI](https://doi.org/10.1108/IJQRM-05-2013-0075)) | Per-SC rolling EMA of 5 SERVQUAL dimensions from post-service survey. |
| P3 | **Customer Effort Score** | Dixon, Freeman, Toman, *HBR*, 2010 "Stop Trying to Delight Your Customers" ([HBR](https://hbr.org/2010/07/stop-trying-to-delight-your-customers)) | 1-item CES after booking commit: *"How easy was it to book today's service?"* 1–7. |
| P4 | **Net Promoter Score** | Reichheld, *HBR*, 2003 "The One Number You Need to Grow" ([HBR](https://hbr.org/2003/12/the-one-number-you-need-to-grow)) | Post-service NPS 0–10. |
| P5 | **CSAT** | ACSI methodology — Fornell et al., *J. Marketing* 1996 ([DOI](https://doi.org/10.1177/002224299606000403)) | Post-service CSAT 1–5. |
| P6 | **Wait-time satisfaction** | **Maister's propositions** — Maister 1984, HBS 9-684-064 ([PDF](http://www.columbia.edu/~ww2040/4615S13/Psychology_of_Waiting_Lines.pdf)) | ∈ [0,1] from (explained, occupied, in-process, solo, fair, certain) booleans; plus `1 − |actual_wait − promised_wait| / promised_wait` accuracy term. |
| P7 | **Cost Transparency Index** | Carter & Curry, *J. Marketing* 2010 ([DOI](https://doi.org/10.1509/jmkg.74.6.112)) "The Effects of Cost Transparency…"; Mohan, Buell, John, *Management Science* 2020 ([DOI](https://doi.org/10.1287/mnsc.2018.3251)) | 0/1 for each of: itemised quote up-front, parts-vs-labour split, OEM-vs-aftermarket disclosure, warranty terms shown, tax shown, total match vs final bill ≤ 2 %. Index = mean. |
| P8 | **Loaner / mobility continuity** | ACSI automotive-service research; also J.D. Power CSI ([jdpower.com/business/automotive](https://www.jdpower.com/business/automotive)) | Bool: `loaner_available OR mobile_mechanic OR same_day` during the service window. |
| P9 | **Estimated repair-time accuracy** | Maister P6-related; Buell & Norton, *Management Science* 2011 "Think Customers Hate Waiting?" ([DOI](https://doi.org/10.1287/mnsc.1110.1418)) | `max(0, 1 − |actual − estimated| / estimated)`. |
| P10 | **Algorithmic fairness across areas, vehicle ages, genders** | NIST *AI RMF 1.0* ([NIST](https://www.nist.gov/itl/ai-risk-management-framework)); Barocas, Hardt, Narayanan, *Fairness and Machine Learning* 2023 ([fairmlbook.org](https://fairmlbook.org/)) | Demographic-parity difference in average dispatch quality across segments ≤ 5 %. Monitored weekly, alert on drift. |
| P11 | **Trust in autonomous AI advisor** | Glikson & Woolley, *Acad. Mgmt. Annals* 2020 ([DOI](https://doi.org/10.5465/annals.2018.0057)); Lee & See, *Human Factors* 2004 ([DOI](https://doi.org/10.1518/hfes.46.1.50_30392)) | 3 items post-booking: "I understand why this recommendation was made" / "I can override it" / "I feel safe acting on it." Mean ∈ [1,5]. |
| P12 | **Accessibility compliance** | **WCAG 2.2 AAA** — W3C ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)) | Automated axe-core score + manual audit % for AAA criteria on every page. |

## 2. Composite score

```
W = 0.25*safety_term
  + 0.15*P6_wait
  + 0.12*P7_CTI
  + 0.10*P9_time_accuracy
  + 0.10*P2_SERVQUAL
  + 0.08*P11_trust
  + 0.08*P8_continuity
  + 0.05*P3_CES
  + 0.04*P5_CSAT
  + 0.03*P4_NPS
```

with `safety_term = 1 − normalized(P1)` (so driving-under-fault lowers the score), and `P10_fairness` acting as a **gate** (system-level alarm) rather than an additive term — we don't want a booking's score to look good because the algorithm is quietly discriminating.

Default weights are justified by relative evidence mass in the cited papers and by `w₁ = 2.5 × (avg of convenience weights)` in `dispatch.md` — safety/wellbeing dominates.

Weights are **published** in the user-facing explanation drawer — part of our trust (P11) strategy per Glikson & Woolley.

## 3. UI/UX rules for "aura"

Grounded in HCI research, not aesthetic preference:

1. **Always explain the wait** — Maister P3.
2. **Show progress, never raw spinners** — Maister P6 + Buell & Norton "operational transparency".
3. **Explain AI reasoning in one line, offer detail drawer** — Glikson & Woolley; reduces over- and under-trust.
4. **Offer override on every AI decision** — Lee & See calibrated trust; our `Override` button is always one tap.
5. **Cost up-front, itemised** — Mohan, Buell, John 2020.
6. **Never surprise the customer** — any change > 10 % to ETA, price, or scope triggers a push + consent confirm.
7. **WCAG 2.2 AAA** — 7:1 contrast (SC 1.4.6), target size 44×44 (SC 2.5.5), focus-not-obscured AAA (SC 2.4.12), dragging movements alternative (SC 2.5.7), accessible authentication no cognitive test (SC 3.3.9), consistent help (SC 3.2.6).
8. **Reduced-motion + captions + alt-text** — line one, not a toggle.
9. **Voice-first intake** available in Hindi + regional — accessibility + convenience.
10. **"Why we're asking"** tooltip on every data field (DPDP-friendly + trust).

## 4. Red-flag safety overrides (hard rules)

These bypass every optimisation and dispatch a tow / emergency advisor even if customer insists otherwise. The customer is told exactly why. No weighting, no softening.

| Trigger | Action |
|---|---|
| Brake warning red / pedal goes to floor / leak at caliper | Tow. Ban drive-in. |
| Steering warning / loss of assist / pull severe | Tow. Ban drive-in. |
| Airbag deployed in last 24 h | Recommend certified collision centre, not regular SC. |
| Engine fire / visible smoke from hood | Emergency services link + tow. |
| Coolant over-temp light red + drive >5 km | Tow (prevent head-gasket damage). |
| Oil pressure red light | Tow. |
| ADAS fault + highway speed usage declared | Disable ADAS recommendation + immediate diagnostic slot. |
| EV battery thermal warning | Tow to EV-capable SC; instruct park-away-from-structures. |
| Driver reports feeling unsafe | Tow, full stop. |

Implementation: the hardcoded `SAFETY_RED_FLAGS` set in `packages/shared/src/safety.ts` is cross-checked **twice** — once by the intake agent, once by a deterministic post-check before commit.

## Sources

- [Parasuraman, Zeithaml, Berry 1988 SERVQUAL](https://doi.org/10.2307/1251430)
- [Izogo & Ogba 2015 AutoSERVQUAL](https://doi.org/10.1108/IJQRM-05-2013-0075)
- [Dixon, Freeman, Toman 2010 CES — HBR](https://hbr.org/2010/07/stop-trying-to-delight-your-customers)
- [Reichheld 2003 NPS — HBR](https://hbr.org/2003/12/the-one-number-you-need-to-grow)
- [Fornell et al. 1996 ACSI](https://doi.org/10.1177/002224299606000403)
- [Maister 1984](http://www.columbia.edu/~ww2040/4615S13/Psychology_of_Waiting_Lines.pdf)
- [Buell & Norton 2011](https://doi.org/10.1287/mnsc.1110.1418)
- [Mohan, Buell, John 2020](https://doi.org/10.1287/mnsc.2018.3251)
- [Carter & Curry 2010](https://doi.org/10.1509/jmkg.74.6.112)
- [Glikson & Woolley 2020](https://doi.org/10.5465/annals.2018.0057)
- [Lee & See 2004](https://doi.org/10.1518/hfes.46.1.50_30392)
- [NIST AI RMF 1.0](https://www.nist.gov/itl/ai-risk-management-framework)
- [Barocas, Hardt, Narayanan 2023](https://fairmlbook.org/)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [J.D. Power CSI](https://www.jdpower.com/business/automotive)

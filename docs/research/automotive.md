# Research: Automotive Data, Diagnostics, and Intake Schema — April 2026

> Goal: give the agent the exact dataset a senior service advisor would write on the work-order, every time, with zero fabrication.

## 1. VIN decoding

**Primary: NHTSA vPIC `DecodeVinValues`** — free, no registration, 24/7. Endpoint: `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json`. No official rate limit published; NHTSA applies automated throttling, practical ceiling ~10–15 rps ([NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/), [catalog.data.gov listing](https://catalog.data.gov/dataset/nhtsa-product-information-catalog-and-vehicle-listing-vpic-vehicle-api-json)). Returns make, model, year, body class, engine, fuel, drive type, plant, GVWR, airbag config, and 100+ other fields. Works for most VINs sold in the US since 1981.

**India fallback:** **Vahan / mParivahan** RC (registration certificate) lookup via the **NIC Parivahan Sewa API**. Officially requires integration through a state DTO or a SURVL-registered aggregator (Signzy, Karza/Perfios, Surepass) since direct access was restricted in 2022. We ship the aggregator adapter but require the operator to plug their own key — the RTO data itself is government-owned ([Parivahan Sewa](https://parivahan.gov.in/)).

**Global fallback:** Auto.dev / DataOne / CarMD paid APIs for markets vPIC doesn't cover. Adapter interface only in v1.

## 2. Connected-vehicle + OBD

**Primary: Smartcar**. Token-based OAuth consent from the vehicle owner; covers ICE data crucial for service — oil life, tire pressure, odometer, fuel level, engine-fault indicators, DTCs on supported OEMs, and a fleet adapter. No dongle required for OEM-supported cars. Recent changes relevant to us: webhook format change **17 Nov 2025**; vehicle refresh tokens now expire **10 min** after use (up from 1 min) as of **12 Nov 2025**; `CONNECTOR` → `CHARGING_TYPE` rename on **28 Jan 2026** ([Smartcar changelog](https://smartcar.com/docs/changelog/latest), [Smartcar autocare guide](https://smartcar.com/blog/autocare-software)).

**Dongle fallback:** Bluetooth OBD-II dongle (ELM327 clones, or the open-hardware `macchina A0`) for owners whose car isn't covered. Read standard PIDs, mode $03 (stored DTCs), mode $07 (pending), $09 (VIN / CAL-ID), and freeze-frame.

**India:** few cars have OEM connected APIs. Default is dongle + user-reported data, with Smartcar covering Tata Nexon EV, Mahindra XUV400/700, Hyundai/Kia connected cars, MG. Rest rely on symptoms + photos + audio.

## 3. DTC database

- **Generic P/B/C/U codes** — public, ingestible from SAE J2012 and community databases (we ship a JSON file with descriptions + severity + suspected-system).
- **Manufacturer-specific** — licensed only. We define a pluggable `DtcResolver` interface; the ONLY data shipped in the repo is the generic set. OEM codes must be attached by the operator under their own license from Mitchell1 / ALLDATA / Haynes Pro.

## 4. Repair knowledge corpus

- **NHTSA recalls + TSB metadata** — public datasets, refreshed weekly ([NHTSA datasets](https://www.nhtsa.gov/nhtsa-datasets-and-apis)).
- **ARAI / Ministry of Road Transport India recall notices** — public.
- **Common-symptom / common-fix pairs** — we bootstrap from an open dataset of service cases (RepairPal public explanations, public-domain workshop manuals).
- **Licensed OEM manuals** — plug-in ingestor, not shipped.

Ingestion: Document AI for PDF TSBs → GraphRAG chunks in AlloyDB + Vertex Vector Search, as designed in `agentic.md`.

## 5. Symptom → diagnosis literature

We do not claim a novel ML diagnosis model. We stand on two well-cited bases:
- **Rule-based symptom graphs** (the same approach real service writers use) — each symptom → candidate systems → candidate DTCs → candidate repairs, authored from the dataset above.
- **LLM-assisted retrieval** — retrieve TSBs and manual passages by symptom description; the model proposes a ranked differential, always with citations. Grounded on RAGAS-style faithfulness gating.

Relevant recent literature: [Rengasamy et al. 2020 — Deep learning approaches to aircraft maintenance, repair and overhaul](https://arxiv.org/abs/2007.01807) (transferable principles); [Khoshkangini et al. 2021 — Predictive maintenance for heavy-duty trucks using LSTMs](https://doi.org/10.1016/j.ress.2021.107610). We do not ship a predictive model in v1; we gate any predictive feature behind real field data.

## 6. Indian market specifics

Popular makes we must render nicely from day one: Maruti Suzuki, Hyundai, Tata, Mahindra, Kia, Toyota, Honda, MG, Skoda, VW (4-wheel); Bajaj, Hero, TVS, Royal Enfield, Honda, Yamaha, Ather, Ola Electric (2-wheel).

Symptom capture: **English + Hindi** primary; Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam, Punjabi ready via i18n. Voice intake routed through Google Cloud Speech-to-Text with regional models.

RTO / FASTag / insurance lookup — pluggable via aggregator keys.

## 7. Warning-light taxonomy

ISO 2575 pictogram set + colour severity:

- **Red** (STOP) — oil pressure, brake-system, engine-critical, airbag, coolant over-temp → **immediate tow red-flag, no drive-in**.
- **Amber** (caution) — CEL/MIL, ABS, TPMS, battery, DPF → drive-in allowed if no safety-critical symptom, prefer mobile mechanic if distance > 30 km.
- **Green / blue** — informational, no escalation.

Source: [UNECE R121 / ISO 2575](https://unece.org/transport/documents/2021/06/standards/un-regulation-no-121-rev3).

## 8. Exhaustive intake schema

The concrete schema is shipped at [`packages/shared/src/schema/intake.ts`](../../packages/shared/src/schema/intake.ts) as Zod and re-exported. Field groups:

1. **Owner** — id, name, contact (phone E.164, email RFC 5322), preferred lang, preferred channel, emergency contact.
2. **Vehicle identity** — VIN (17 char ISO 3779) *or* registration-plate+RTO-state, make, model, trim/variant, year, fuel type, transmission, displacement/kWh, odometer (km), colour, purchase date, warranty expiry, insurance provider + policy expiry, FASTag id (optional), modifications.
3. **Service history (structured)** — last service date, last service odometer, last service type, provider, open recalls (fetched from NHTSA/ARAI), last oil type + brand, brake pad life estimate, tire age (DOT codes) + brand + size + pressure readings if known, battery age.
4. **Current issue** — free-text symptom in user's language + structured tags (noise | vibration | smell | leak | warning-light | performance | cosmetic | scheduled-maintenance | accident).
5. **Symptom details (if noise)** — when it happens (cold-start / idle / accel / brake / steady-speed / turning), where it seems to come from (front/rear/left/right/under-hood/undercarriage), audio upload.
6. **Symptom details (if warning-light)** — photo of cluster, light name if known, flashing vs steady, colour.
7. **Symptom details (if performance)** — loss of power / rough idle / stall / hard start / misfire / overheating / transmission slip / ABS-TCS active / steering pull.
8. **Severity self-report** — can you drive safely? 5-point scale + any of {brake failure, steering failure, fire, smoke, fluid on ground}.
9. **Telemetry pull (if Smartcar/OBD connected)** — odometer, fuel, DTCs, freeze-frame, battery SOC, tire pressures.
10. **Pickup / drop preference** — drive-in, mobile mechanic, tow, pickup-drop-off service. Location (lat/long + address), preferred date/time window, alternate window, loaner needed (y/n), contact pref.
11. **Cost sensitivity** — budget ceiling (optional), want detailed quote before work (y/n), accept OEM / OES / aftermarket parts.
12. **Consent & privacy** — DPDP explicit consent bundle per purpose (service fulfilment, diagnostics telemetry, marketing opt-in as separate toggle).

Validation rules: VIN checksum (ISO 3779), odometer monotonic vs history, dates not in future, E.164, image ≤ 10 MB, audio ≤ 30 s default. No field is fabricated by the agent — missing = ask.

## RECOMMENDED API STACK

| Need | Primary | Fallback | Notes |
|---|---|---|---|
| VIN decode (US-origin) | NHTSA vPIC (free) | Auto.dev / DataOne | cache 30 days |
| India RC lookup | Aggregator (Signzy / Karza / Surepass) | user-entry | operator-owned key |
| Connected data | Smartcar | Dongle (ELM327) | user consent required |
| DTC descriptions | Generic J2012 (shipped) | Licensed OEM | operator plug-in |
| Recalls | NHTSA recalls API | ARAI | weekly sync |
| STT | Google Cloud Speech-to-Text | Gemini 2.5 multimodal | Hindi + regional |
| Geocoding | Google Maps Geocoding | — | required |

Sources:
- [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/)
- [NHTSA datasets & APIs](https://www.nhtsa.gov/nhtsa-datasets-and-apis)
- [Free VIN Decoder API Comparison 2026](https://cardog.app/blog/free-vin-decoder-api-comparison)
- [Smartcar changelog](https://smartcar.com/docs/changelog/latest)
- [Smartcar autocare](https://smartcar.com/blog/autocare-software)
- [UNECE R121 rev.3](https://unece.org/transport/documents/2021/06/standards/un-regulation-no-121-rev3)
- [Rengasamy et al. 2020](https://arxiv.org/abs/2007.01807)
- [Khoshkangini et al. 2021](https://doi.org/10.1016/j.ress.2021.107610)
- [Parivahan Sewa](https://parivahan.gov.in/)

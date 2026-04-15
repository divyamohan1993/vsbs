# Research: Dispatch, Maps, GCP — April 2026

> Goal: autonomously pick drive-in vs mobile-mechanic vs tow; assign service center or technician; respect safety, wait time, load balance.

## 1. Google Maps Platform

Production APIs we use (docs all last-updated ~April 2026):

| API | Purpose |
|---|---|
| **Routes API** | door-to-door driving distance, duration, duration-in-traffic, polyline, toll info. Replaces the legacy Directions API for all new builds ([docs](https://developers.google.com/maps/documentation/routes)). |
| **Routes API `:computeRouteMatrix`** | many-to-many origin-destination matrix for candidate-service-center ranking. Note: the old **Distance Matrix API is LEGACY since 2025-03-01** ([deprecations](https://developers.google.com/maps/deprecations), [March 2025 changes](https://developers.google.com/maps/billing-and-pricing/march-2025)). Google Maps ETA under `TRAFFIC_AWARE_OPTIMAL` is GNN-backed via the DeepMind collaboration — up to 50 % accuracy gain in major cities ([DeepMind blog](https://deepmind.google/discover/blog/traffic-prediction-with-advanced-graph-neural-networks/), [arXiv 2108.11482](https://arxiv.org/abs/2108.11482)). |
| **Route Optimization API** (GMPRO) | **solves our mobile-mechanic VRP**. Accepts shipments + vehicles + time windows + capacities; returns optimal stop sequences. Replaces deprecated **Cloud Fleet Routing** (deprecated 16 Jan 2025). Billed per shipment, two SKUs: single-vehicle, fleet ([GMPRO docs](https://developers.google.com/maps/documentation/route-optimization), [billing](https://developers.google.com/maps/documentation/route-optimization/usage-and-billing), [afi.io GMPRO overview](https://blog.afi.io/blog/gmpro-google-maps-platform-route-optimization-api/)). |
| **Places API (New)** | find the nearest partner service centers, hours, ratings. |
| **Geocoding API** | address ↔ lat/long, reverse geocoding. |
| **Roads API** | snap tow-truck / mobile mechanic routes. |
| **Time Zone API** | normalise bookings across states. |

Caching: Google Maps ToS allows caching distance/duration for **up to 30 days** and Places `place_id` indefinitely — we cache aggressively in Memorystore to cut spend ([Google Maps terms](https://cloud.google.com/maps-platform/terms)).

## 2. GCP service map

| Subsystem | GCP service | Why |
|---|---|---|
| Web hosting | **Cloud Run** (serve Next.js via `@opennextjs/cloudflare`-style adapter or direct) | scale-to-zero, regional |
| API runtime | **Cloud Run** (Hono on Node 22) | same |
| Agent runtime | **Claude Managed Agents** (external) + Vertex AI Agent Builder for Gemini routes | best-in-class |
| Primary DB | **Firestore (Native mode)** for booking state + user prefs | multi-region, offline-first SDK |
| Analytical DB | **BigQuery** for telemetry + ML | — |
| Relational / KG | **AlloyDB for PostgreSQL** for repair KG | pgvector + ltree |
| Vector | **Vertex AI Vector Search** | hybrid dense+sparse |
| Pub/sub | **Pub/Sub** | event backbone |
| Scheduled jobs | **Cloud Scheduler + Cloud Run Jobs** | nightly reflection, recall sync |
| Secrets | **Secret Manager** | with Cloud KMS auto-rotate |
| WAF / bot | **Cloud Armor + reCAPTCHA Enterprise** | DDoS + bot defence |
| Auth | **Identity Platform (Firebase Auth)** + phone/OTP | India-primary login |
| CDN | **Cloud CDN** in front of Cloud Run | static + signed URLs |
| Logging | **Cloud Logging** + structured JSON | required |
| Metrics + dashboards | **Cloud Monitoring** + **Managed Service for Prometheus** | — |
| Tracing | **Cloud Trace** via OpenTelemetry | — |
| Error aggregation | **Error Reporting** | SIEM feed |
| Storage | **Cloud Storage** (multi-region) | photos, audio, docs |
| PDF ingestion | **Document AI** | TSBs, manuals |
| Voice | **Cloud Speech-to-Text** (Chirp 3) + **Text-to-Speech** | i18n voice intake |
| Translation | **Cloud Translation** + Gemini fallback | Indic languages |
| Confidential compute | **Confidential VMs / Confidential GKE Nodes** | PII workloads |
| Zero-trust ingress | **IAP + BeyondCorp** for admin SIEM | — |
| Policy | **VPC-SC** + **Binary Authorization** | supply-chain + exfil control |

## 3. Dispatch algorithm

**Inputs**
- Customer lat/long (`loc_c`), preferred window `[t_start, t_end]`, severity class `s ∈ {red, amber, green}`.
- Vehicle telemetry or red-flag symptoms `F`.
- Candidate service centers `{SC_i}` with (lat/long, hourly capacity, current load, specialist skills, loaner availability, historical CSAT, price tier).
- Candidate mobile mechanics `{MM_j}` with (current route, remaining capacity, skill tags, hourly rate).
- Live travel times via Distance Matrix.

**Constraints** (all must be satisfied)
1. `s == red` → **tow required**, ban drive-in and mobile.
2. If `F` contains any safety red-flag (brake, steering, fire, smoke) → `s := red`.
3. Travel distance customer→SC ≤ 25 km AND travel time ≤ 45 min OR mobile is preferred.
4. SC must be skill-competent for the suspected system (engine / transmission / electrical / body / ADAS …).
5. Customer's preferred window must intersect an available slot, OR an adjacent slot within ±2h is proposed.

**Objective** (minimise)
```
J = w1 * travel_min
  + w2 * wait_min
  + w3 * (1 - load_balance_score)
  + w4 * cost_estimate
  - w5 * wellbeing_score
  - w6 * historical_csat
```
Weights default `w1=1, w2=1.5, w3=0.8, w4=0.3, w5=2.5, w6=1.2` — wellbeing carries the highest weight. Weights are configurable per-operator and logged.

`load_balance_score` is `1 − (center_load / center_capacity)` clipped to [0,1]. Rationale from M/M/c queue theory: at utilisation > 0.8, expected wait explodes non-linearly ([Gross, Shortle, Thompson & Harris, *Fundamentals of Queueing Theory*, 5th ed., Wiley, 2018](https://onlinelibrary.wiley.com/doi/book/10.1002/9781119453765)), so we penalise utilisation > 0.75.

**Mobile-mechanic VRP sub-problem.** When the best candidate is a mobile mechanic already on a route, we call **Route Optimization API** with the new shipment inserted, respecting their time windows and working hours. The VRP formulation used is Solomon's VRPTW ([Solomon 1987, *Operations Research* 35(2)](https://pubsonline.informs.org/doi/10.1287/opre.35.2.254)); GMPRO solves large instances in sub-second.

## 4. Safety-first decision tree

```
if severity == red OR any red-flag symptom present:
    dispatch = TOW + nearest capable SC, priority booking
    never propose customer drives
elif telemetry has amber DTC AND distance_to_SC_km > 30:
    dispatch = MOBILE MECHANIC if available for symptom class
    else TOW if customer opts (recommended) else earliest SC slot
elif severity == amber:
    dispatch = DRIVE-IN preferred, mobile fallback
else:
    dispatch = per customer preference
```

Red-flag symptom list (any one = red): brake-pedal-soft, brake-warning-red, no-steering-assist, steering-pull-severe, engine-fire, smoke-from-hood, coolant-boiling, oil-pressure-red-light, airbag-deployed-recent, fluid-puddle-large.

## 5. Waiting-time psychology (feeds wellbeing score)

Maister's eight propositions are the foundation of how we communicate wait: **occupied waits feel shorter; uncertain waits feel longer; unexplained waits feel longer; unfair waits feel longer; valuable service is waited-for more patiently; solo waits feel longer than group waits; anxious waits feel longer; pre-process waits feel longer than in-process** ([Maister 1984, HBS 9-684-064](http://www.columbia.edu/~ww2040/4615S13/Psychology_of_Waiting_Lines.pdf)).

Implications built into the UI: queue-number + live ETA + explanation ("Technician Ravi is finishing oil-pan reseal, 22 min"); no silent spinners; progress bars always explain current step.

## Sources

- [Google Maps Routes API](https://developers.google.com/maps/documentation/routes)
- [GMPRO Route Optimization API](https://developers.google.com/maps/documentation/route-optimization)
- [GMPRO billing](https://developers.google.com/maps/documentation/route-optimization/usage-and-billing)
- [afi.io GMPRO overview](https://blog.afi.io/blog/gmpro-google-maps-platform-route-optimization-api/)
- [js-route-optimization-app GitHub](https://github.com/googlemaps/js-route-optimization-app)
- [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms)
- [Solomon 1987 VRPTW](https://pubsonline.informs.org/doi/10.1287/opre.35.2.254)
- [Gross et al. 2018](https://onlinelibrary.wiley.com/doi/book/10.1002/9781119453765)
- [Maister 1984](http://www.columbia.edu/~ww2040/4615S13/Psychology_of_Waiting_Lines.pdf)
- [OR-Tools routing](https://developers.google.com/optimization/routing)

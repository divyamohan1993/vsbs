# Architecture — Autonomous Vehicle Service Booking System

> Synthesised from `docs/research/*`. Every design choice points back to a cited research doc.

## Goals (non-negotiable)

1. **Zero-touch autonomous** intake → diagnosis → scheduling → dispatch → fulfilment → auto-pay → return.
2. **Safety first** — red-flag overrides, sensor cross-validation, no driving on unsafe faults.
3. **Personalised like a senior service advisor** — memory per vehicle and owner, explainable every step.
4. **PhD-grade** — every claim grounded, every decision logged, every parameter cited.
5. **Production-grade** from line one — no placeholders, no mocks except explicit sensor simulators flagged `origin: "sim"`.
6. **WCAG 2.2 AAA** + DPDP-native + PQ-hybrid from day one.
7. **Works on a slow phone and bad network** in India; offline-first.

## High-level topology

```
                        ┌───────────────────────────────┐
                        │  User (web / mobile / voice)  │
                        └──────────────┬────────────────┘
                                       │  HTTPS (PQ hybrid)
                ┌──────────────────────▼──────────────────────┐
                │  apps/web  Next.js 15 (App Router, React 19)│
                │  • PWA offline-first  • WCAG 2.2 AAA        │
                │  • i18n en/hi + Indic • SSE status stream   │
                └──────────────────────┬──────────────────────┘
                                       │  REST + SSE
                ┌──────────────────────▼──────────────────────┐
                │  apps/api  Hono on Cloud Run (Node 22)      │
                │  • Zod schema validation                    │
                │  • Rate limit + CSP + auth                  │
                │  • Idempotency keys                         │
                └──────┬───────────┬──────────┬───────────────┘
                       │           │          │
      ┌────────────────▼┐ ┌────────▼────┐ ┌───▼──────────────┐
      │ Concierge agent │ │ Tool layer  │ │ Event bus Pub/Sub│
      │ Claude Opus 4.6 │ │ strict Zod  │ │                  │
      │ + Haiku verifier│ │ • VIN       │ │                  │
      └─┬───────────────┘ │ • DTC       │ └──────┬───────────┘
        │                 │ • Maps      │        │
        │                 │ • Dispatch  │        │
        │                 │ • Wellbeing │        │
        │                 │ • Autonomy  │        │
        │                 │ • Pay       │        │
        │                 └─────┬───────┘        │
        │                       │                │
  ┌─────▼─────┐   ┌─────────────▼───┐   ┌────────▼───────┐
  │ Firestore │   │ AlloyDB + Vect. │   │ Cloud Tasks /  │
  │ (booking, │   │  repair KG / KB │   │  Scheduler     │
  │ consent,  │   │  GraphRAG       │   │  (reflection,  │
  │ grants)   │   │                 │   │  recall sync)  │
  └───────────┘   └─────────────────┘   └────────────────┘
```

### Live autonomy hub (booking-scoped pub/sub)

A separate seam carries the on-vehicle telemetry stream that the autonomy
dashboard subscribes to. The hub keeps the on-vehicle producers (real
CARLA bridge or the GPU-free chaos scenario driver) decoupled from the
dashboard consumers; it owns the L5 frame schema and a ring buffer per
booking so a fresh subscriber lands on a populated view.

```
   tools/carla/  ─┐                           ┌─►  /v1/.../telemetry/sse  ─►  apps/web
   (bridge or     │   POST /v1/autonomy/      │                              SensorSuite
    chaos driver) ├──►   :id/telemetry/ingest ├─►  LiveAutonomyHub  ─►       PerceptionEventLog
                  │   POST .../events/ingest  │   (ring-buffered fan-out)
                  └────────────────────────────┘   ┌─►  /v1/.../events/sse  ─►  apps/web
                                                   │
                                                   └─►  synthetic-frame  (deterministic L5
                                                       fallback when bridge is silent)
```

Schema covers the full surface a Tesla FSD HW4 / Waymo 6 / Mobileye
Chauffeur / Wayve stack publishes off-vehicle: 8 surround cameras, 4× 4D
imaging radars, solid-state LiDAR, LWIR thermal, 8-mic audio array,
multi-constellation GNSS+RTK (GPS / GLONASS / Galileo / BeiDou / NavIC),
9-DoF IMU, per-corner wheel encoders, motors + 96-cell HV pack with
isolation resistance + three coolant loops, AURIX lockstep + HSM
heartbeat, 5G NR-V2X + MEC RTT + HD-map sync, V2X bus (BSM / SPaT / MAP /
CAM / DENM), ODD compliance + Mahalanobis OOD score + UNECE R157 takeover
ladder + capability budget + MRM, DMS gaze + cabin air, environment,
software versions. See [`apps/api/src/adapters/autonomy/live-hub.ts`](../apps/api/src/adapters/autonomy/live-hub.ts).

## Agents (from `agentic.md`)

| Agent | Model | Scope |
|---|---|---|
| **Concierge (supervisor)** | `claude-opus-4-6` 1M | Owns the conversation, dispatches specialists, commits decisions |
| **Intake specialist** | `claude-haiku-4-5` | Structured field extraction from natural-language + image + audio |
| **Diagnosis specialist** | `claude-opus-4-6` | RAG over repair KG, differential ranking with citations |
| **Dispatch specialist** | `claude-opus-4-6` + deterministic solver | Safety-aware scheduling + Maps + GMPRO |
| **Wellbeing specialist** | `claude-haiku-4-5` | Composite score + aura messaging |
| **Autonomy specialist** | `claude-opus-4-6` | Capability tiering, command grant issuance, sensor fusion calls |
| **Payment specialist** | `claude-haiku-4-5` | Cap enforcement, PI creation, receipt/tax invoice |
| **Verifier** | `claude-haiku-4-5` | Groundedness + tool-arg provenance gate |

Orchestration uses Claude Managed Agents in beta (`managed-agents-2026-04-01`), with LangGraph as a local fallback for dev.

## Core contracts

- **`Intake`** — Zod schema in `packages/shared/src/schema/intake.ts` (see `automotive.md` §8).
- **`SensorBundle`** — union of real + simulated channels, each stamped with `origin`.
- **`FusedObservation`** — output of the fusion layer with per-channel trust weights and residual diagnostics.
- **`SafetyAssessment`** — `red | amber | green` + red-flag list (see `wellbeing.md` §4).
- **`DispatchDecision`** — `{ mode: "drive-in" | "mobile" | "tow" | "avp", target, eta, wellbeing, wait, cost }`.
- **`CommandGrant`** — signed, time-bounded authority capability (see `autonomy.md` §5).
- **`WellbeingScore`** — weighted composite (see `wellbeing.md` §2).
- **`ConsentRecord`** — append-only per-purpose (see `security.md` §2).

## Safety invariants (system-wide)

1. A confirmed red-flag → **tow, non-overridable**.
2. A single-sensor fault assertion → **suspected**, never **confirmed**, until cross-validated.
3. A `CommandGrant` never outlives 6 h, never exceeds geofence, never exceeds auto-pay cap.
4. Every autonomous action is witnessed by the concierge + logged with cryptographic chain.
5. An override button is one tap away on every page, including during autonomous operation.
6. **PHM invariant** (from `prognostics.md`): a tier-1 component in `Unsafe` state blocks autonomous operation and triggers driver-takeover if in motion.
7. **SOTIF invariant** (ISO 21448): a suspected sensor failure never upgrades to a confirmed fault without independent corroboration; likewise a confirmed fault is never dismissed as "probably a sensor."
8. **Graceful degradation**: loss of a tier-1 perception sensor → autonomy refused, owner is asked to drive the car manually (with full guidance) or request a tow.

## PHM layer (from `prognostics.md`)

An always-on subsystem mirroring the six ISO 13374 stages (Acquire → Manipulate → State Detect → Health Assess → Prognose → Advise). Outputs per component a `(stateEnum, P(fail|horizon), sigma, source)` tuple. The autonomy agent and the UI both consume the **lower confidence bound** for safety decisions. State transitions drive the graceful-degradation ladder: `Healthy → Watch → Act-soon → Critical → Unsafe`, with the last state invoking a driver-takeover or tow, per UNECE R157 MRM.

## Data flow (one booking)

1. User opens `/book` → PWA loads offline shell → `Intake` draft is a local Automerge doc.
2. Concierge asks only the fields that are missing, in user's language; voice + text accepted.
3. Intake specialist extracts structured fields → schema validated → provenance-tagged.
4. Dispatch specialist calls `safetyCheck(SensorBundle, Intake)` → red/amber/green.
5. Diagnosis specialist retrieves from repair KG, ranks candidates with citations.
6. Dispatch solves: service centers via Places, travel via Routes, VRP via GMPRO, wait via capacity model.
7. Wellbeing specialist scores each option; ranker minimises `J` (see `dispatch.md` §3).
8. Concierge presents the top option with an explanation drawer + override; user confirms.
9. If autonomous tier A is available → autonomy specialist mints a `CommandGrant`, dispatches via OEM API.
10. SC takes the car in, posts its quote; payment specialist enforces auto-pay cap.
11. Work complete → evidence stored in Cloud Storage → return leg fires.
12. Post-service: wellbeing survey, memory update, reflection job, recall sync.

## Tech stack summary

| Layer | Choice | Cite |
|---|---|---|
| Web | Next.js 15 + React 19 + shadcn/ui + Tailwind 4 + next-intl 4 + Dexie + Automerge | `frontend.md` |
| API | Hono 4 on Node 22 on Cloud Run | `dispatch.md` |
| Agents | Claude Managed Agents (beta) + LangGraph dev fallback | `agentic.md` |
| Primary model | `claude-opus-4-6` (1M ctx) | `agentic.md` |
| Cheap specialist / verifier | `claude-haiku-4-5-20251001` | `agentic.md` |
| Grounded search | Gemini 2.5 Pro via Vertex AI | `agentic.md` |
| Booking DB | Firestore (asia-south1) | `security.md` |
| Analytics | BigQuery | `dispatch.md` |
| KG + vectors | AlloyDB for PostgreSQL + Vertex AI Vector Search | `agentic.md` |
| Events | Pub/Sub | `dispatch.md` |
| Maps | Routes API + Places (New) + Route Optimization API + Geocoding | `dispatch.md` |
| VIN decode | NHTSA vPIC (free) | `automotive.md` |
| Connected car | Smartcar (+ OBD-II dongle fallback) | `automotive.md` |
| STT | Cloud Speech-to-Text Chirp 3 | `frontend.md` |
| Secrets | Secret Manager + Cloud KMS hybrid envelope | `security.md` |
| Auth | Identity Platform + passkeys + WebAuthn | `security.md`, `autonomy.md` |
| Observability | OpenTelemetry → Cloud Logging / Monitoring / Trace | `security.md` |
| CI/CD | GitHub Actions → Artifact Registry → Binary Auth → Cloud Run | `security.md` |

## Repository layout

```
.
├─ apps/
│  ├─ web/                Next.js 15 (public + me + autonomy dashboards)
│  └─ api/                Hono on Cloud Run (agent tools + data plane)
├─ packages/
│  ├─ shared/             Zod schemas, safety, wellbeing, types, constants
│  ├─ sensors/            Sensor simulator + real adapters + fusion (Kalman)
│  ├─ agents/             Agent definitions, tool registry, verifier chain
│  └─ kb/                 Repair knowledge + DTC descriptions (generic)
├─ infra/
│  └─ terraform/          GCP IaC
├─ docs/
│  ├─ research/           Cited research (7 docs)
│  ├─ architecture.md
│  └─ compliance/         DPIA, FRIA, AI risk register
├─ .github/workflows/
└─ README.md
```

## Gap-audit (first pass)

| Gap | Mitigation |
|---|---|
| OEM repair manuals are licensed, can't ship | Plug-in ingestor; operator attaches their own |
| India RC lookup needs aggregator | Adapter interface with operator key |
| Real L4 self-drive to SC not GA | Tier-A AVP real path + human pickup fallback, same UX |
| Payment processors vary by market | `PaymentAdapter` interface — Razorpay + Stripe + UPI shipped |
| DTC manufacturer-specific codes licensed | Generic shipped; plug-in for licensed |
| Prompt injection on retrieved TSBs | Trust-channel separation + markdown stripping + verifier |

## Open items tracked in `docs/compliance/ai-risk-register.md`

- DPIA / FRIA for autonomous-handoff + auto-pay.
- Model versioning + rollback policy.
- Bias audit cadence for dispatch.
- Data-retention schedule per purpose.

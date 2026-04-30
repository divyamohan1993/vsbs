> # ⚠️ READ BEFORE YOU DEPLOY — RESEARCH-GRADE SOFTWARE, NOT A CERTIFIED SAFETY SYSTEM
>
> **VSBS is a research-grade reference architecture and educational artefact. It is NOT a certified safety-of-life system, NOT a type-approved automotive product, and NOT a substitute for OEM functional-safety engineering.** Deploying this code as a primary safety control loop on a real vehicle, on a public road, or in any environment where its failure could cause physical harm or death is **prohibited** until you have independently completed every certification, validation, and underwriting gate listed in [`SAFETY-NOTICE.md`](SAFETY-NOTICE.md) — at minimum **ISO 26262**, **ISO 21448 (SOTIF)**, **ISO/SAE 21434 + UNECE R155**, **UNECE R156**, **UNECE R157** type approval, independent third-party assessor sign-off (TÜV/DEKRA/UL DQS), DPIA + FRIA, and underwritten product-liability insurance.
>
> **Legitimate uses** today are: research, teaching, prior-art reference, **advisory-only** dashboards (no actuator authority), back-office booking/concierge, simulation, and as a multi-year regulated-engineering starting point.
>
> **NO WARRANTY · NO LIABILITY.** Per Apache 2.0 §§7-8, the Work is provided "AS IS." **Whoever deploys this code owns the deployment, the safety case, the regulatory approvals, the insurance, and the consequences. The original author bears none of these.**
>
> Honest accounting of what is real / partial / missing → [`docs/gap-audit.md`](docs/gap-audit.md). Full safety statement → [`SAFETY-NOTICE.md`](SAFETY-NOTICE.md).

---

<div align="center">

# VSBS

### Autonomous Vehicle Service Booking System — Research Reference Implementation

**Zero-touch. Safety-first. Research-cited. PhD-grade. Reference architecture.**

An open-source, agentic, fully-cited reference implementation that an OEM, fleet, or research lab can fork as the *starting point* for a regulated engineering program — not a finished product to ship to a real vehicle.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-0a84ff.svg?style=flat-square)](LICENSE)
[![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun 1.3](https://img.shields.io/badge/Bun-1.3-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.sh)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-20232a?style=flat-square&logo=react&logoColor=61dafb)](https://react.dev)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2-1c3d5a?style=flat-square)](https://langchain-ai.github.io/langgraph)
[![Hono](https://img.shields.io/badge/Hono-4-ff5500?style=flat-square&logo=hono&logoColor=white)](https://hono.dev)
[![Tailwind 4](https://img.shields.io/badge/Tailwind-4-0ea5e9?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![1169 tests](https://img.shields.io/badge/tests-1169%20passing-2ea44f?style=flat-square)](#tests--verification)
[![smoke 32/32](https://img.shields.io/badge/smoke-32%2F32-2ea44f?style=flat-square)](#tests--verification)
[![Live CARLA](https://img.shields.io/badge/CARLA-live%20%E2%9C%93-2ea44f?style=flat-square)](#end-to-end-verification)
[![WCAG 2.2 AAA](https://img.shields.io/badge/WCAG-2.2%20AAA-2ea44f?style=flat-square)](https://www.w3.org/TR/WCAG22/)
[![DPDP Native](https://img.shields.io/badge/DPDP%202025-native-ff8c00?style=flat-square)](docs/compliance/dpia.md)
[![EU AI Act](https://img.shields.io/badge/EU%20AI%20Act-FRIA-ff8c00?style=flat-square)](docs/compliance/fria.md)
[![PQ TLS](https://img.shields.io/badge/PQ-ML--KEM--768-9cf?style=flat-square)](docs/research/security.md)
[![Research grade](https://img.shields.io/badge/research-cited-9146ff?style=flat-square)](docs/research/)

**[Quick start](#quick-start) · [Architecture](#architecture) · [Research](#research) · [Roadmap](docs/roadmap-prod-deploy.md) · [Contribute](CONTRIBUTING.md)**

</div>

---

## The pitch in thirty seconds

Most vehicle-service apps optimise for *distance and price*. VSBS optimises for **customer wellbeing** — safety, stress, transparency, trust — and treats the service-advisor job as a **fully autonomous agentic workflow** you can click through on a slow phone with zero human operators in the loop.

It composes six things that nobody usually ships together:

1. A **LangGraph supervisor** with a verifier chain on every tool call.
2. A **provider-agnostic LLM layer** that runs on free-tier Gemini, production Vertex Claude, OpenAI, Anthropic direct, or a **scripted sim driver with zero API keys**.
3. A **deterministic sensor simulator** with Kalman fusion and SOTIF-aligned fault-vs-sensor-failure arbitration.
4. A **prognostic health state machine** per ISO 13374 that refuses autonomous operation when a tier-1 safety-critical sensor is dead.
5. A **DPDP-2025-native** append-only consent log with evidence hashes and a 72-hour breach runbook.
6. A **post-quantum hybrid envelope** for long-lived secrets using Cloud KMS ML-KEM-768 + X25519.

Every architectural decision is traceable to peer-reviewed research or a published standard. See [`docs/research/`](docs/research/) for the citation trail and [`docs/defensive-publication.md`](docs/defensive-publication.md) for the prior-art filing.

<br/>

## What you get when you clone it

| You get | Built from |
|---|---|
| A real `/v1/concierge/turn` SSE endpoint streaming typed agent events | Hono on Bun + LangGraph + scripted LLM |
| A real NHTSA vPIC VIN decode | Free public API, no key |
| A full Razorpay order → intent → authorise → capture → settle flow | Exact prod state machine in sim mode |
| A 4 + 1 step booking wizard that renders the agent trace live | Next.js 16 + React 19 + React Compiler |
| A composite wellbeing score with 10 peer-reviewed sub-scores | `packages/shared/src/wellbeing.ts` |
| A hard-coded safety red-flag gate with post-commit double-check | `packages/shared/src/safety.ts` |
| A CommandGrant capability token model for autonomous handoff | `packages/shared/src/autonomy.ts` |
| A scalar Kalman filter and cross-modal arbitrator for sensor fusion | `packages/sensors/src/fusion.ts` |
| WCAG 2.2 AAA demo banner, 44x44 targets, OKLCH palette, focus-visible rings | `apps/web` |
| 125 unit tests, 25 HTTP smoke tests, full CI pipeline with Trivy SBOM | `.github/workflows/ci.yml` |

<br/>

## Quick start

Prerequisites: **Node 22+**, **pnpm 9+**, **Bun 1.2+**. Nothing else.

```bash
# 1. Clone + install
git clone https://github.com/divyamohan1993/vsbs.git
cd vsbs
pnpm install --ignore-scripts

# 2. Build the library packages
pnpm run build:libs

# 3. Prove the baseline is green
pnpm -r typecheck    # 6/6 packages clean
pnpm -r test         # 125 tests passing
pnpm run build       # full repo build

# 4. Boot the API in sim mode (zero API keys needed)
cd apps/api
LLM_PROFILE=sim PORT=8787 bun src/server.ts &

# 5. Watch a real autonomous booking turn
curl -sN -X POST http://localhost:8787/v1/concierge/turn \
  -H 'content-type: application/json' \
  -d '{"conversationId":"demo","userMessage":"My 2024 Honda Civic is grinding when I brake"}'
```

You should see a live SSE trace — **tool-call → verifier → tool-result → delta → final** — with the deterministic safety and wellbeing engines returning real results, driven by a LangGraph supervisor, through a provider-agnostic LLM layer, on **zero external API calls**.

Flip `LLM_PROFILE=demo` + set `GOOGLE_AI_STUDIO_API_KEY` and the exact same transcript runs on Gemini 2.5 Flash-Lite. Flip to `prod` and it runs on Claude Opus 4.6 via Vertex AI. **One env var. No code change.**

<br/>

## CARLA demo quickstart

The headline VSBS demo runs the full autonomous-service loop end to end: a fault is injected, PHM detects it, parts-aware dispatch picks a service centre, a signed command-grant is minted, the vehicle drives itself to the centre, gets serviced, and a fresh return-grant brings it home. Watch it live at `/demo/carla` in the web app.

```bash
# 1. start the API in sim mode
( cd apps/api && LLM_PROFILE=sim PORT=8787 bun src/server.ts ) &

# 2. install the bridge (Python 3.10+)
cd tools/carla
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 3. run in replay mode (no CARLA install required)
python -m vsbs_carla.scripts.run_demo \
  --replay tools/carla/replay/town10hd-brake-failure.jsonl \
  --headless

# Or run the smoke test that does both in one shot:
bash tools/carla/scripts/smoke.sh
```

Live CARLA mode needs the CARLA 0.10.0 binary; the bridge auto-falls-back to the bundled deterministic trace when CARLA isn't installed, which means the demo runs in CI on any machine. Full guide in [`docs/demo/carla.md`](docs/demo/carla.md).

<br/>

## Architecture

```mermaid
flowchart TB
  subgraph browser["apps/web · Next.js 16 + React 19"]
    Home["/"] --> Book["/book wizard"]
    Book -->|"Confirm"| Concierge["Concierge runner · live SSE"]
    Concierge --> Status["/status/:id ticker"]
    Status --> Autonomy["/autonomy/:id dashboard"]
  end

  subgraph proxy["apps/web/api/proxy · CSP self-only bridge"]
    ProxyRoute["strips headers · streams body"]
  end

  browser -- "/api/proxy/*" --> ProxyRoute

  subgraph api["apps/api · Hono on Bun on Cloud Run"]
    MW["defense-in-depth middleware"]
    Routes["/v1/* routes"]
    MW --> Routes
  end

  ProxyRoute -- "/v1/*" --> MW

  subgraph agents["packages/agents · LangGraph supervisor"]
    Supervisor["concierge supervisor"]
    Verifier["verifier chain"]
    Tools["tool registry · 10 Zod-validated tools"]
    Memory["Mem0 pattern memory"]
    Supervisor --> Verifier
    Verifier --> Tools
    Tools --> Supervisor
    Supervisor -.-> Memory
  end

  Routes -- "SSE concierge/turn" --> agents
  Tools -- "real HTTP back into" --> Routes

  subgraph llm["packages/llm · provider-agnostic"]
    Registry["LlmRegistry · role-keyed"]
    SimP["scripted · zero keys"]
    GAI["google-ai-studio"]
    VG["vertex-gemini"]
    VC["vertex-claude"]
    Anth["anthropic"]
    OAI["openai"]
    Registry --> SimP
    Registry --> GAI
    Registry --> VG
    Registry --> VC
    Registry --> Anth
    Registry --> OAI
  end

  agents --> Registry

  subgraph shared["packages/shared · Zod contracts"]
    Intake["intake schema"]
    Safety["safety red-flags"]
    Wellbeing["wellbeing composite"]
    PHM["PHM state machine"]
    Grant["CommandGrant model"]
    Payment["payment state machine"]
  end

  Routes --> shared
  agents --> shared

  subgraph sensors["packages/sensors"]
    Kalman["Kalman fusion"]
    Sim["fault-injected simulator"]
    RUL["physics-of-failure RUL"]
  end

  Routes --> sensors
```

**Read in this order:** [`docs/architecture.md`](docs/architecture.md) → [`STACK.md`](STACK.md) → [`docs/research/agentic.md`](docs/research/agentic.md) → [`docs/research/autonomy.md`](docs/research/autonomy.md) → [`docs/research/prognostics.md`](docs/research/prognostics.md) → [`docs/gap-audit.md`](docs/gap-audit.md).

<br/>

## The autonomous booking loop

```mermaid
sequenceDiagram
    autonumber
    participant U as Owner
    participant W as apps/web
    participant A as apps/api
    participant L as LangGraph supervisor
    participant V as Verifier (cheap model)
    participant S as Safety + Wellbeing engines
    participant P as Payments adapter (sim or live)

    U->>W: fills booking wizard · OTP · VIN · symptoms
    W->>A: GET /v1/vin/:vin (real NHTSA)
    W->>A: POST /v1/safety/assess
    A-->>W: severity + rationale
    U->>W: click Confirm
    W->>A: POST /v1/concierge/turn (SSE)
    A->>L: runTurn(state, userMessage)
    loop each tool call
      L->>V: is this tool call grounded?
      V-->>L: yes · reason
      L->>S: assessSafety / scoreWellbeing
      S-->>L: deterministic result
      L-->>A: tool-call · verifier · tool-result events
      A-->>W: SSE frames
    end
    L-->>A: final assistant message
    A-->>W: SSE final + end
    W-->>U: streamed trace + recommendation card
    U->>W: approve cost and commit
    W->>A: POST /v1/payments/orders (idempotent)
    A->>P: order-created → intent → authorised → captured → settled
    P-->>A: webhook events (same bus in sim and live)
    A-->>W: settled
```

Every arrow is real code you can read today. Every `sim` path implements the identical state machine as its `live` counterpart, per [`docs/simulation-policy.md`](docs/simulation-policy.md).

<br/>

## Repository layout

```text
.
├── apps
│   ├── api          Hono on Bun · defense-in-depth middleware · 12 route groups · 35 tests
│   └── web          Next.js 16 · booking wizard · live concierge · autonomy dashboard · consent
├── packages
│   ├── shared       Zod schemas · safety · wellbeing · autonomy · PHM · payment state machine
│   ├── sensors      Kalman fusion · simulator with fault injection · RUL models
│   ├── llm          Provider-agnostic LLM · 6 providers · sim / demo / prod profiles
│   └── agents       LangGraph supervisor · verifier chain · Mem0 memory · 10 VSBS tools
├── infra
│   └── terraform    GCP baseline · Cloud Run · Firestore · Secret Manager · IAM
├── docs
│   ├── research          8 cited research documents · the spine of every decision
│   ├── compliance        DPIA · FRIA · AI risk register · breach runbook · retention
│   ├── architecture.md   Synthesis
│   ├── roadmap-prod-deploy.md   93-item build list through Phase 12
│   ├── simulation-policy.md     Sim + live share the state machine · one toggle
│   ├── defensive-publication.md Prior art for 12 inventive concepts · dated 2026-04-15
│   └── gap-audit.md             Honest what-is-real vs what-is-partial inventory
├── .github           Issue + PR templates · CODEOWNERS · dependabot · CI
├── CLAUDE.md         Project brief for any fresh Claude session that opens this repo
├── CONTRIBUTING.md   How to contribute without bouncing
├── SECURITY.md       Vulnerability disclosure policy
├── SUPPORT.md        How to ask questions that land
├── STACK.md          Exact versioned stack choices with justification
├── CHANGELOG.md      Keep a Changelog format
├── CITATION.cff      Academic citation metadata
├── LICENSE           Apache 2.0
└── NOTICE            Attribution framed as an adopter benefit
```

<br/>

## What is autonomous today

VSBS implements the **information and decision layer** for the service-advisor job (intake, diagnosis, dispatch, payment, status) at a level of automation comparable to L4 *for that job*, and provides honest **Tier A AVP refusal-or-defer** logic for the driving portion. It is **not** a driving-automation product. It does not steer, brake, or accelerate any vehicle. It composes a *protocol* (CommandGrant) for delegating motion authority to an OEM autonomy stack that is itself certified — which today means only Mercedes/Bosch Intelligent Park Pilot at APCOA P6 Stuttgart, and only with a real signed integration we do not yet hold.

| Function | Autonomous today | Grade |
|---|---|---|
| Conversation + intake (voice, text, images) | yes | L4 |
| Safety red-flag assessment with double-check | yes, deterministic | L4 |
| Diagnosis (RAG over DTC + TSB, cited) | yes | L4 |
| Dispatch ranking (wellbeing-dominant objective) | yes | L4 |
| Slot booking + load balance | yes | L4 |
| Autonomy capability resolver + grant minting | yes (honest refusal outside Tier A) | L4 |
| Auto-pay within user-set cap, cap bound to the grant | yes | L4 |
| PHM + takeover ladder per UNECE R157 | yes | L4 |
| **Driving to the service centre** | only where the vehicle supports Mercedes/Bosch AVP; human pickup path otherwise | Tier A or L0 pickup |

Read the honest accounting in [`docs/gap-audit.md`](docs/gap-audit.md) and the tiered-autonomy reality check in [`docs/research/autonomy.md`](docs/research/autonomy.md) §1.

<br/>

## Research

Every claim VSBS makes about architecture, safety, wellbeing, autonomy, prognostics, and agentic AI is grounded in a cited source. The research corpus lives at [`docs/research/`](docs/research/):

| Document | What it proves |
|---|---|
| [`agentic.md`](docs/research/agentic.md) | The agent stack (LangGraph · Claude Opus 4.6 · Mem0 · GraphRAG · speculative cascade routing) is April 2026 SOTA |
| [`automotive.md`](docs/research/automotive.md) | The intake schema, VIN decode stack, and India BS6 Phase 2 reality |
| [`dispatch.md`](docs/research/dispatch.md) | Maps + routing + VRP + wellbeing-dominant objective function |
| [`wellbeing.md`](docs/research/wellbeing.md) | The 10-parameter composite score, every sub-score traced to a peer-reviewed source |
| [`security.md`](docs/research/security.md) | PQ hybrid TLS, DPDP 2025, OWASP GenAI Top 10, zero-trust GCP posture |
| [`frontend.md`](docs/research/frontend.md) | Next.js 16 + React 19 + WCAG 2.2 AAA + Maister-aligned copy |
| [`autonomy.md`](docs/research/autonomy.md) | Tiered autonomy reality check and CommandGrant capability model |
| [`prognostics.md`](docs/research/prognostics.md) | ISO 13374 PHM + ISO 21448 SOTIF + uncertainty-aware RUL + UNECE R157 takeover |

Plus [`docs/research/addendum-2026-04-15.md`](docs/research/addendum-2026-04-15.md) with the deltas that landed when parallel specialist agents re-audited the corpus.

<br/>

## Compliance

VSBS ships a full compliance pack at [`docs/compliance/`](docs/compliance/):

- [`dpia.md`](docs/compliance/dpia.md) — DPDP Rules 2025 + GDPR Art. 35 Data Protection Impact Assessment.
- [`fria.md`](docs/compliance/fria.md) — EU AI Act Art. 27 Fundamental Rights Impact Assessment, 10-row go/no-go table.
- [`ai-risk-register.md`](docs/compliance/ai-risk-register.md) — 18 rows mapped to NIST AI RMF 1.0 + OWASP GenAI Top 10 2025, every row citing a concrete source file.
- [`consent-notices/README.md`](docs/compliance/consent-notices/README.md) — Consent notice versioning index with a mermaid lifecycle.
- [`breach-runbook.md`](docs/compliance/breach-runbook.md) — 72-hour DPDP Rule 7 breach notification playbook.
- [`retention.md`](docs/compliance/retention.md) — Per-purpose retention schedule matching `ConsentPurposeSchema`.

None of this is legal advice. It is a starting point that is more complete than what most projects ship on day one.

<br/>

## Tests + verification

VSBS maintains five overlapping verification layers, all green on Linux x86_64.

**Unit tests — 1 003 passing across 12 workspaces**

```text
@vsbs/shared       233   safety, wellbeing, autonomy, phm, payment, vehicle, ODD,
                         coverage, calibration, grant heartbeat, offline envelope,
                         dual-control, signed geofences
@vsbs/sensors       88   Kalman, EKF, fusion, simulator, RUL, signed frames,
                         provenance guard, anomaly monitor, J1939 driver
@vsbs/llm           33   model pin registry, canary router
@vsbs/agents       107   LLM safety fence, confidence envelope, output filter,
                         memory scope
@vsbs/security      87   PQ KEM, ML-DSA-65, KMS envelope, WebAuthn, PII redaction,
                         CSP, rate limit, key ceremony, release signing
@vsbs/compliance    34   consent ledger, erasure coordinator, breach runbook,
                         DPIA / FRIA, jurisdiction matrix
@vsbs/telemetry     43   OTel, structured logger, metrics, health, SLO
@vsbs/kb            62   AlloyDB / pgvector hybrid, BGE-M3 embeddings, GraphRAG,
                         DTC corpus, ISO 2575 tell-tales, Indic NLP
@vsbs/api          168   12 route groups, defense-in-depth middleware, payments
@vsbs/web           85   shadcn-grade primitives, autonomy dashboard, redaction,
                         DP analytics
@vsbs/mobile        46   typed API client, BLE OBD, grant signing, notifications,
                         offline outbox
@vsbs/admin         17   audit-crypto, DataTable, StatusPill
```

**Specialised suites — 166 more**

```text
agent-eval        102   BFCL function-calling 54 + tau2 multi-turn 12 + red-team 36
property tests     37   fast-check on VIN, India plate, intake, payment, wellbeing
chaos              27   dependency-fail, db-unavailable, llm-timeout, sensor-storm
```

**Live HTTP smoke — 32 probes**

```text
healthz · readyz · metrics · llm config · vin (real NHTSA decode) · safety
green + red · wellbeing · otp demo round-trip · capability v2 (Mercedes IPP) ·
takeover ladder · grant heartbeat · offline envelope mint + verify · dual-control ·
sensor ingest (with provenance summary) · phm actions · dispatch shortlist ·
KB hybrid search · DTC lookup · payment order + intent · security headers
```

**Live concierge SSE turn**

```bash
curl -sN -X POST http://localhost:8787/v1/concierge/turn \
  -H 'content-type: application/json' \
  -d '{"conversationId":"demo","userMessage":"My 2024 Honda Civic is grinding when I brake"}'
```

Emits a real `tool-call → verifier → tool-result → delta → final → end` SSE trace. The C3 output filter is observed live: when the scripted LLM said *"the vehicle is safe to drive in the short term"*, the safety fence rewrote the final emission to *"I cannot certify safety; please consult a qualified mechanic."*

CI runs all three on every PR. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

<br/>

## End-to-end verification

A complete witness run on a single Linux x86_64 box (no special hardware), recorded under [`docs/verification/`](docs/verification/). Runtime: Node 25, Bun 1.3, pnpm 9, Python 3.12, Ubuntu 24.04 kernel 6.17.

**Live CARLA 0.9.16 on a 2 GB GPU** — the demo runs in true headless mode using `-RenderOffScreen -opengl -quality-level=Low -ResX=240 -ResY=180`, plus `world.no_rendering_mode = True`. VRAM stayed at **5 MiB** throughout. Map `Town03_Opt` loaded in 42 s after a one-shot warmup with `client.set_timeout(600)`.

```text
ego: tesla.model3   NPCs: 4   fault: drive-belt-age   target: GoMechanic Karol Bagh (274.9 m)

t= 5.0s  drive-belt 0.9   RUL=198.9 km   declining
t= 8.1s            0.8        131.4 km   declining
t=10.5s  PHM PREDICTIVE ALERT — predicted-critical-in=4s
         → drafting booking pre-emptively
         BOOKING_PENDING → AWAITING_GRANT → DRIVING_TO_SC
t=11.1s  drive-belt 0.6   RUL= 65.0 km   declining (en route)
         TOW REQUIRED — fault progress=99% (full critical reached en route)
         → /v1/dispatch/<id>/halt-for-tow  (200 OK)
         state = HALTED_AWAITING_TOW
```

That is the SOTIF-style graceful-degradation path firing on a real CARLA simulator: predict, book, drive, catch the fault accelerating mid-route, halt the autonomous drive, and escalate to a tow.

A second run against [`tools/carla/replay/town10hd-brake-failure.jsonl`](tools/carla/replay/town10hd-brake-failure.jsonl) closes the happy-path loop end to end: 22 HTTP calls all 2xx, full state machine `DRIVING_HOME_AREA → FAULT_INJECTING → BOOKING_PENDING → AWAITING_GRANT → DRIVING_TO_SC → SERVICING → AWAITING_RETURN_GRANT → DRIVING_HOME → DONE`, 2 grants minted (outbound + return).

Both branches share the same bridge plumbing and the same API endpoints. Logs and the full report are in [`docs/verification/`](docs/verification/).

<br/>

## The simulation policy

> For every external dependency with a `_MODE` toggle, the sim and live drivers implement the identical state machine and behaviour. Promotion is a single environment-variable flip. No code path changes. No behaviour changes. No "cleanup pass before going live."

This is the load-bearing rule that lets VSBS run a full booking end-to-end with zero API keys while being structurally ready for production. Read [`docs/simulation-policy.md`](docs/simulation-policy.md) for the full discipline and the subsystems it applies to.

<br/>

## Defensive publication

Under Apache 2.0 plus public disclosure, [`docs/defensive-publication.md`](docs/defensive-publication.md) establishes twelve inventive concepts as prior art under 35 U.S.C. §102, EPC Art. 54, and Indian Patents Act §13, dated **2026-04-15**. Any later patent filing reading on these concepts is invalidated by this publication.

<br/>

## Roadmap

Phase 1 is complete. The full 93-item build list through Phase 12 is at [`docs/roadmap-prod-deploy.md`](docs/roadmap-prod-deploy.md). Next pending blocks:

1. **Phase 2** — Real Smartcar adapter, EKF / UKF for multi-state channels, command-grant signing with passkeys and ML-DSA-65, Mercedes/Bosch AVP adapter.
2. **Phase 3** — AlloyDB + pgvector + Vertex Vector Search for the repair knowledge graph.
3. **Phase 4** — Dual-region India + US deployment.
4. **Phase 5-7** — DPDP consent manager integration, zero-trust hardening, full observability.

<br/>

## Contributing

We review PRs that cite a paper, a standard, or a concrete production use-case. We reject PRs that weaken a safety invariant, add unjustified dependencies, or introduce placeholders. Full rules at [`CONTRIBUTING.md`](CONTRIBUTING.md). Security findings at [`SECURITY.md`](SECURITY.md). Community questions at [`SUPPORT.md`](SUPPORT.md).

<br/>

## License + attribution

Licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Short version for adopters:

- You **can** use, modify, ship, white-label, commercialise, and integrate this in any product. No royalty. No permission needed.
- You **must** keep the `LICENSE` and `NOTICE` in any redistribution. The NOTICE is short and is framed as a *benefit* to you: research pedigree, standards trail, open partnership channel, patent safety.
- **Trademarks** are not granted. Pick your own product name.
- **No warranty, no liability** (Apache 2.0 §§7-8). You own your deployment's safety case, DPIA, FRIA, regulatory approvals, insurance, and incident response. **The author does not.** See [`SAFETY-NOTICE.md`](SAFETY-NOTICE.md).

Copyright © 2026 **Divya Mohan** ([dmj.one](https://dmj.one)). Partnerships and OEM integration: `contact@dmj.one`.

<br/>

<div align="center">

**If this helps you ship, consider [starring the repo](https://github.com/divyamohan1993/vsbs) — it is the cheapest way to tell the author the work matters.**

**Built in India. Designed for the world.**

</div>

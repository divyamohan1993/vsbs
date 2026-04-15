# Gap Audit — coherence and completeness

A honest accounting of what is real, what is partial, and what is a documented roadmap item. "PhD-grade" requires telling the truth about your own limits; this is that page.

## What is fully real in this repo

| Area | File(s) | Status |
|---|---|---|
| Exhaustive intake schema (Zod, inferred types, ISO 3779 VIN validator with check digit) | `packages/shared/src/schema/` | Complete |
| Safety red-flag assessment + double-check | `packages/shared/src/safety.ts` | Complete |
| Customer Wellbeing Composite Score (pure O(1)) | `packages/shared/src/wellbeing.ts` | Complete |
| Autonomy CommandGrant capability model | `packages/shared/src/autonomy.ts` | Complete |
| PHM state machine + action resolver | `packages/shared/src/phm.ts` | Complete |
| Sensor type contracts | `packages/shared/src/sensors.ts` | Complete |
| Scalar Kalman filter | `packages/sensors/src/fusion.ts` | Complete (v1) |
| Cross-modal arbitration (confirmed / suspected / sensor-failure) | `packages/sensors/src/fusion.ts` | Complete |
| Sensor simulator with fault injection | `packages/sensors/src/simulator.ts` | Complete (brake, TPMS, BMS) |
| Physics-of-failure RUL models | `packages/sensors/src/rul.ts` | Brake pads, 12 V battery |
| Hono API on Bun with real endpoints | `apps/api/src/server.ts` | Complete |
| NHTSA vPIC real adapter | `apps/api/src/adapters/nhtsa.ts` | Complete |
| Google Maps Routes API v2 real adapter | `apps/api/src/adapters/maps.ts` | Complete |
| Strict CSP (nonce, no unsafe-inline) | `apps/web/src/middleware.ts` | Complete |
| Next.js 16 + React 19 + Tailwind 4 scaffold | `apps/web/` | Landing, /book, /status/[id] |
| i18n (en, hi) | `apps/web/messages/` + `src/i18n/request.ts` | Complete, 8 regional extensible |
| Terraform GCP baseline | `infra/terraform/` | Cloud Run × 2, Firestore, Secret Manager, Artifact Registry, IAM, APIs |
| CI (lint, typecheck, test, build, Trivy) | `.github/workflows/ci.yml` | Complete |
| 8 cited research docs + STACK.md + architecture.md + compliance index | `docs/` | Complete |

## What is partial and why

| Area | What's shipped | What's missing | Why |
|---|---|---|---|
| Agent orchestration | Tool contracts + server routes the agent's tools call | The Claude Managed Agents client call itself | Managed Agents beta requires account-level enrollment and the operator's own key; we ship the target surface and plug in the client at deploy time. |
| Repair knowledge graph (GraphRAG) | Interface + storage design in `docs/research/agentic.md` | The ingestion pipeline and AlloyDB schema | OEM manual licensing is operator-specific; generic J2012 DTC text ships as a separate resource drop. |
| India RC lookup | Adapter interface in `.env.example` | Signzy / Karza / Surepass client | Each aggregator has its own contract; operator picks one, wires the key. |
| HV battery SoH | Type + physics placeholder | Data-driven ensemble model | Requires real field data; benchmarked on Severson 2019 before productionisation. |
| LiDAR / radar fusion | Type contracts + simulator channels | Full EKF + track association | Consumer vehicles do not expose raw LiDAR as of April 2026; simulator lets the pipeline be developed. |
| Autonomous Tier A path (AVP) | Capability resolver + grant minting | The OEM's driverless-parking API call | Only Mercedes/Bosch Stuttgart is commercially approved; our `AUTONOMY_TIER_A_AVP_PROVIDERS` list + capability gate is the hook. |
| Voice intake | Web Speech fallback chain documented | The Chirp-3 server route | Straightforward to wire, deferred to v1.1. |
| Admin SIEM dashboard | Log schema + Cloud Logging emit | The Next.js admin UI | Internal tool; not critical path for launch. |
| End-to-end tests | Vitest scaffold in every package | Playwright a11y pipeline | Deferred to v1.1 — budget for the full battery. |

## What is intentionally **not** in this repo

| Area | Why |
|---|---|
| OEM repair manuals (Mitchell1, ALLDATA, Haynes) | Licensed; cannot ship. Plugin interface only. |
| Full C-MAPSS-trained transformer weights | Requires training infra + eval harness; documented in `prognostics.md`. |
| Real L4/L5 self-drive-to-service for private cars | Not commercially available as of April 2026 on any OEM. We refuse to fake it. See `autonomy.md` §1. |
| Mocks and test doubles in production | Forbidden per project policy. Simulator data is `origin: "sim"` and blocked from real decision logs. |

## Coherence checks (second-pass audit)

1. **Safety ↔ PHM ↔ Autonomy.** A confirmed red-flag blocks autonomy; an Unsafe tier-1 PHM state blocks autonomy; autonomy capability check is called before grant minting. The three gates compose, and a failure in any one of them results in a tow or a human-pickup path, never a silent downgrade. ✅
2. **Wellbeing ↔ Dispatch objective.** Wellbeing composite is the single largest weight (`w5 = 2.5`) in the dispatch objective. ✅
3. **DPDP consent ↔ every PII read.** The consent purpose enum gates the agent tools that touch the relevant PII bucket; no tool can read telemetry without `diagnostic-telemetry` consent. ✅
4. **Citations.** Every research doc ends with a Sources section; every decision in `architecture.md` points at one of those docs. ✅
5. **O(1) claim.** Every route in `apps/api/src/server.ts` is either pure or a single keyed call; no route scans a tenant collection. ✅
6. **Accessibility.** Every interactive element in `apps/web` satisfies the AAA §2.5.5 minimum via a global CSS rule; focus-visible satisfies §2.4.12 via global rule; colour palette defined in OKLCH with verified 7:1 pairs (§1.4.6). ✅
7. **Sensor provenance.** Every `SensorSample` carries `origin: "real" | "sim"`; the fusion output carries an `originSummary` so any decision log including simulated data is clearly marked. ✅

## Known trade-offs

- **Bun in production** — Bun is fast and production-deployable but has less ops tooling than Node. We gate the API runtime choice on Cloud Run's Bun support; if an operator prefers Node 22 the same code runs unchanged because Hono is runtime-agnostic.
- **Managed Agents is a beta** — the API surface may change. We keep the client module thin and pin the beta header in `.env.example`.
- **PPR is labelled `incremental`** — we enable it only on pages whose shell is static.

## Next steps (ordered)

1. Wire the Claude Managed Agents client + tool registry (`packages/agents`).
2. Ingest NHTSA recalls + generic DTC corpus into AlloyDB + Vertex Vector Search.
3. Ship the voice-intake Chirp-3 route.
4. Stand up admin SIEM Next.js route under IAP.
5. Add Playwright + axe-core CI.
6. Run a DPIA + FRIA before enabling `AUTONOMY_ENABLED=true`.

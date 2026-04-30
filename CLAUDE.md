# CLAUDE.md — VSBS project brief for any Claude session

**Read this first if you are a Claude session opened in this repo.** It is the shortest path to picking up where the last session left off. The global `~/.claude/CLAUDE.md` already sets identity + style + engineering rules; this file is the project-specific overlay.

## What this is

**VSBS — Autonomous Vehicle Service Booking System.** A zero-touch, safety-first, research-cited, production-shape system that lets a vehicle owner book a service, get an autonomous recommendation, and (when the OEM supports it) hand the car over to the service centre under a signed command-grant capability. India-first (DPDP 2023 + Rules 2025), US-second (CCPA / CPRA), EU-ready (AI Act Art. 27 FRIA scoped).

Core value prop: every architectural decision is grounded in peer-reviewed research, international standards, or vendor docs — traceable through `docs/research/*`. Author is **Divya Mohan (dmj.one, contact@dmj.one)**. Licensed Apache 2.0 with a strong NOTICE explaining the attribution as a *benefit* to adopters.

## Current state (as of 2026-04-15)

- **All 6 packages typecheck clean** under `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **125 unit tests passing** across `@vsbs/shared` (73), `@vsbs/sensors` (17), `@vsbs/api` (35).
- **25/25 HTTP smoke tests passing** against a running API (see `/tmp/smoke.sh`).
- **Live end-to-end concierge turn** works: POST `/v1/concierge/turn` → LangGraph supervisor → scripted LLM → real tool handlers → SSE trace. Zero external API keys in sim mode.
- **Full repo builds**: libs via tsc, API via `bun build`, web via `next build` (Next.js 16.2.3, 7 routes).

**Phase 1 of [`docs/roadmap-prod-deploy.md`](docs/roadmap-prod-deploy.md) is complete** — core autonomous booking loop with demo-mode OTP, LangGraph agent orchestrator, intake conversation, diagnosis, dispatch, wellbeing scoring, payments end-to-end (Razorpay sim driver with exact prod state machine), status dashboard, demo banners. Phase 2 (sensor + PHM + autonomy foundations — real Smartcar, EKF, command-grant signing) is the next pending block.

## How to run it

Prerequisites: Node 22+, pnpm 9+, Bun 1.2+. Nothing else.

```bash
cd /mnt/experiments/vehicle-service-booking-system
pnpm install --ignore-scripts
pnpm run build:libs                       # emit dist/ for @vsbs/shared, sensors, llm
pnpm -r typecheck                         # all 6 packages clean
pnpm -r test                              # 125 tests
pnpm run build                            # full repo build

# Live demo:
cd apps/api && LLM_PROFILE=sim PORT=8787 bun src/server.ts &   # runs without any API keys
bash /tmp/smoke.sh                        # 25/25 passing
curl -s http://localhost:8787/readyz
curl -sN -X POST http://localhost:8787/v1/concierge/turn \
  -H 'content-type: application/json' \
  -d '{"conversationId":"demo","userMessage":"My 2024 Honda Civic is grinding when I brake"}' \
  --max-time 15
```

The **web app** lives under `apps/web` (Next.js 16 + React 19 + Tailwind 4 + next-intl). Start with `pnpm --filter @vsbs/web dev` on port 3000; it proxies to the API via `/api/proxy/[...path]` (strips auth headers, adds x-request-id). Pages: `/`, `/book` (4 + 1 step wizard, last step streams the concierge), `/status/[id]`, `/autonomy/[id]`, `/me/consent`.

## Architecture in one page

```
packages/
  shared/    # Zod schemas (intake, vehicle, consent, dispatch), safety, wellbeing,
             # autonomy (CommandGrant), PHM, payment state machine, sensors types,
             # simulation primitives. O(1) pure functions; no I/O.
  sensors/   # Scalar Kalman, cross-modal arbitration, deterministic simulator with
             # fault injection, physics-of-failure RUL models. All samples carry
             # origin: "real" | "sim"; sim can never enter a real decision log.
  llm/       # Provider-agnostic LLM layer. One interface (`Llm.complete()`), six
             # providers: google-ai-studio, vertex-gemini, vertex-claude, anthropic,
             # openai, scripted. Role-keyed registry + profile-based defaults.
             # LLM_PROFILE=sim | demo | prod — ONE env var flips everything.
  agents/    # LangGraph StateGraph supervisor + verifier chain + Mem0-pattern
             # memory + tool registry. 10 VSBS tools (decodeVin, assessSafety,
             # scoreWellbeing, driveEta, resolveAutonomy, commitIntake, payment
             # create/intent/authorise/capture). `buildVsbsGraph({ llm, apiBase })`
             # is the single entry point.
apps/
  api/       # Hono on Bun on Cloud Run. Defense-in-depth middleware (request-id,
             # structured JSON log with PII redaction, body-size cap, sliding-window
             # rate limiter, secure headers, unified error envelope via `zv()`
             # wrapper around @hono/zod-validator). Routes: auth/otp, payments
             # (Razorpay sim+live with exact state machine), vin (real NHTSA vPIC),
             # safety, wellbeing, eta, intake, dispatch, autonomy, phm, fusion,
             # llm (diagnostic), concierge (SSE), bookings (SSE timeline), me
             # (consent delete). All schema-validated.
  web/       # Next.js 16 + React 19 + Tailwind 4 + next-intl 4. Strict CSP via
             # proxy.ts (was middleware.ts — renamed for Next 16). en + hi full
             # i18n, 7 regional languages ready. AAA-contrast demo banner, 44x44
             # targets, OKLCH palette, focus-not-obscured, reduced-motion honoured.
infra/terraform/  # GCP baseline: Cloud Run x 2, Firestore asia-south1, Secret
                  # Manager, Artifact Registry, IAM, 25 APIs enabled.
docs/
  research/       # 8 cited research docs (agentic, automotive, dispatch, wellbeing,
                  # security, frontend, autonomy, prognostics) + addendum with
                  # April 2026 deltas. Every architectural claim traceable here.
  architecture.md # synthesis of all research into the live topology
  compliance/     # DPIA, FRIA, AI risk register (18 rows), consent notices index,
                  # 72h DPDP breach runbook, retention schedule.
  simulation-policy.md   # The load-bearing rule: sim and live drivers share the
                          # state machine; promotion is a single env var flip.
  defensive-publication.md # Prior-art disclosure for 12 inventive concepts, signed.
  roadmap-prod-deploy.md  # 93-item build list through Phase 12.
  gap-audit.md            # Honest "what is real vs. what is partial" inventory.
STACK.md          # Exact versioned stack choices with justification.
NOTICE            # Attribution framed as adopter benefit, Apache 2.0 §4(d).
LICENSE           # Apache 2.0 full text.
```

## Non-negotiable conventions (do not drift from these)

1. **Everything through Zod.** Every HTTP boundary, every tool argument, every config value. Types are inferred from schemas — never the other way round.
2. **Simulation policy.** For every external dependency with a `_MODE` toggle, sim and live drivers implement the *identical* state machine. Promotion is a single env var flip. Do not take shortcuts in the sim driver — it must faithfully reproduce latency, idempotency, webhook ordering, and error classes. See [`docs/simulation-policy.md`](docs/simulation-policy.md).
3. **No placeholders, no TODOs, no "simplified version".** Every file you write must be complete and correct. Per the user's global CLAUDE.md.
4. **O(1) hot paths.** User-facing routes hit keyed lookups or precomputed candidates. No per-request linear scans. See [`STACK.md`](STACK.md) "Performance doctrine".
5. **Defense in depth.** Request-id → PII-redacting log → body size cap → rate limit → secure headers → Zod validator → unified error envelope. On every route.
6. **Safety invariants.** Hard-coded red-flag set is non-overridable. Double-check (`postCheckSafetyAgrees`) runs before any commit that would let the customer drive. See [`packages/shared/src/safety.ts`](packages/shared/src/safety.ts).
7. **Provenance stamping.** Every `SensorSample` carries `origin: "real" | "sim"`. The fusion layer surfaces an origin summary on every observation. Sim samples cannot enter real customer decision logs.
8. **No em-dashes** in prose. Plain English, short sentences, no emoji.
9. **Apache 2.0 + NOTICE preservation.** The NOTICE is framed as a *benefit* to adopters (research pedigree, standards trail, partnership channel). Do not weaken it.
10. **Author attribution.** The work is **Divya Mohan / dmj.one**. Defensive publication dated 2026-04-15 establishes prior art for 12 concepts. Every doc, every license file, every long-form artefact credits him.

## Where to find things (pointer map)

| If you need to... | Read this first |
|---|---|
| Understand the agent topology + model choices | [`docs/research/agentic.md`](docs/research/agentic.md) + [`STACK.md`](STACK.md) |
| Understand the safety logic | [`packages/shared/src/safety.ts`](packages/shared/src/safety.ts) + [`docs/research/wellbeing.md`](docs/research/wellbeing.md) §4 |
| Understand autonomy tiers + command grants | [`packages/shared/src/autonomy.ts`](packages/shared/src/autonomy.ts) + [`docs/research/autonomy.md`](docs/research/autonomy.md) |
| Understand PHM + SOTIF takeover | [`packages/shared/src/phm.ts`](packages/shared/src/phm.ts) + [`docs/research/prognostics.md`](docs/research/prognostics.md) |
| Understand the LLM provider abstraction | [`packages/llm/src/types.ts`](packages/llm/src/types.ts) + [`packages/llm/src/registry.ts`](packages/llm/src/registry.ts) + [`packages/llm/src/profiles.ts`](packages/llm/src/profiles.ts) |
| Understand the LangGraph supervisor | [`packages/agents/src/graph.ts`](packages/agents/src/graph.ts) + [`packages/agents/src/conversation.ts`](packages/agents/src/conversation.ts) |
| Understand what is real vs. simulated | [`docs/gap-audit.md`](docs/gap-audit.md) + [`docs/simulation-policy.md`](docs/simulation-policy.md) |
| Wire a new OEM / adapter | `apps/api/src/adapters/` (each file is its own sim+live pattern) |
| Ship a web-facing change | `apps/web/src/app/*` — remember strict CSP via `proxy.ts` |
| Add a new agent tool | `packages/agents/src/tools/vsbs.ts` — each tool has a Zod schema + handler |
| Understand the full roadmap | [`docs/roadmap-prod-deploy.md`](docs/roadmap-prod-deploy.md) |
| Know what to build next | [`docs/gap-audit.md`](docs/gap-audit.md) "Next steps" + [`docs/roadmap-prod-deploy.md`](docs/roadmap-prod-deploy.md) Phase 2 |

## What a new Claude session should do

1. Read this file (you are here).
2. Skim [`docs/architecture.md`](docs/architecture.md) and [`docs/gap-audit.md`](docs/gap-audit.md) — together they answer "what is built?" and "what is next?".
3. To verify, ALWAYS use the [`vsbs-verification`](.claude/skills/vsbs-verification/SKILL.md) skill — full nine-layer ladder (typecheck, per-package unit tests, agent eval, property tests, chaos, live HTTP smoke against real schemas, concierge SSE, headless live CARLA, Playwright e2e), then write a witness under `docs/verification/`. Do NOT rely on `pnpm -r test` alone; it short-circuits on the first failing workspace and never exercises live HTTP, CARLA, or the LLM safety fence.
4. Ask the user what they want built next. Do **not** assume; Phase 2 options branch (sensor ingest vs. AlloyDB KG vs. OEM adapter) and the user picks.
5. Once picked, work it end to end: code + tests + typecheck + build + live verification. The bar is "clicks through in a browser with real SSE trace visible", not "compiles".

## Session log

- **2026-04-15** — Initial scaffold + 8 research docs + all core packages. Phase 1 complete. 125 tests, 25 smoke, live concierge SSE, BookingWizard wired to concierge on Confirm with real streamed AgentEvent trace. Four parallel agent teams delivered packages/agents (LangGraph), apps/web polish, vitest suite, and compliance pack in one push. Two latent bugs caught + fixed: `IndiaPlateSchema` ordering (`.max()` before transform), NHTSA `DecodeVinValues` schema shape (flat-keyed, not Variable/Value pairs). Defensive publication filed. Apache 2.0 + NOTICE.
- **2026-04-15 (Phase 2 complete)** — Two parallel agent workstreams on team `vsbs-phase2` delivered roadmap items 11-18. **Sensors workstream**: Smartcar adapter + ELM327 OBD-II BLE dongle adapter (sim/live parity, faithful AT-command wake sequence, SAE J1979 PID parsers); `ExtendedKalman` multi-state filter with GPS+IMU (CTRV), SoC (Plett 2004), cell-imbalance factories; 5 new RUL models (tyres/HV-battery Severson 2019 knee-point/engine-oil J300/drive-belt/wheel-bearings ISO 10816); new `buildSensorsRouter` with 7 routes; pipeline integration test. **Autonomy workstream**: UNECE R157 4-rung takeover ladder + MRM, `commandgrant-lifecycle.ts` (canonical RFC 8785 bytes, WebCrypto ES256/RS256/Ed25519 verifier, SHA-256 Merkle authority chain), `autonomy-registry.ts` with seeded Mercedes IPP OEM registry + APCOA Stuttgart P6 geofence catalogue, `resolveAutonomyCapabilityV2`, Mercedes-Bosch AVP adapter (5-method `authenticate/readState/acceptGrant/performScope/revokeGrant` interface), `buildAutonomyRouter` with 7 new endpoints. Team lead integrated router mounts in `server.ts`, exports in `shared/src/index.ts`, and new env vars (`MERCEDES_IPP_MODE/BASE/TOKEN`) in `.env.example`. **Verification green**: all 6 packages typecheck clean, **176 tests passing** (was 125 → +51: takeover 12, commandgrant-lifecycle 9, autonomy-registry 8, ekf 5, rul +13, pipeline 2, avp mercedes-bosch 3), 25/25 smoke, full repo build clean, live probes of `/v1/autonomy/takeover`, `/v1/autonomy/capability/v2`, `/v1/sensors/ingest` return correct shapes. Next pending: Phase 3 (AlloyDB + pgvector KG, GraphRAG ingestor, DTC corpus, Indic NLP) or a pause for pilot.

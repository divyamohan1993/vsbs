# Changelog

All notable changes to VSBS are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it tags `v1.0.0`.

## [Unreleased]

## [0.1.0] — 2026-04-15

Initial public research preview.

### Added

- **Eight cited research documents** under `docs/research/`:
  `agentic.md`, `automotive.md`, `dispatch.md`, `wellbeing.md`,
  `security.md`, `frontend.md`, `autonomy.md`, `prognostics.md`, plus
  `addendum-2026-04-15.md` with deltas from parallel specialist agents.
- **Architecture synthesis** at `docs/architecture.md` and exact versioned
  stack decisions at `STACK.md`.
- **Simulation policy** (`docs/simulation-policy.md`): sim and live
  drivers share the identical state machine; promotion is a single env
  var flip.
- **Defensive publication** (`docs/defensive-publication.md`) disclosing
  12 inventive concepts dated 2026-04-15 for prior-art protection under
  35 U.S.C. §102, EPC Art. 54, and Indian Patents Act §13.
- **Compliance pack**: DPIA (DPDP Rules 2025 + GDPR Art. 35), FRIA
  (EU AI Act Art. 27), 18-row AI risk register mapped to NIST AI RMF 1.0
  and OWASP GenAI Top 10 2025, consent notice index, 72-hour DPDP Rule 7
  breach runbook, per-purpose retention schedule.
- **`packages/shared`**: Zod schemas for intake, vehicle, consent,
  dispatch, payment state machine with legal transition table, safety
  red-flag engine with post-commit double-check, pure-O(1) wellbeing
  composite scorer, `CommandGrant` capability model, PHM state machine
  per ISO 13374 / 21448 / 26262, sensor provenance types.
- **`packages/sensors`**: scalar Kalman filter, cross-modal arbitration
  (confirmed / suspected / sensor-failure), deterministic simulator with
  fault injection for brake, TPMS, and HV battery channels, physics-of-
  failure RUL models for brake pads and 12 V battery.
- **`packages/llm`**: provider-agnostic LLM layer. One `Llm.complete()`
  interface, six providers — Google AI Studio, Vertex Gemini, Vertex
  Claude, Anthropic direct, OpenAI, and an in-process `scripted` sim
  provider that runs the whole pipeline without API keys. Role-keyed
  registry, three profiles (`sim` / `demo` / `prod`).
- **`packages/agents`**: LangGraph supervisor with verifier chain,
  Mem0-pattern memory, 10 VSBS tool definitions, `buildVsbsGraph()`
  entry point emitting an async-iterable of typed `AgentEvent`s.
- **`apps/api`**: Hono on Bun on Cloud Run with defense-in-depth
  middleware chain (request-id, PII-redacting structured logger, body-
  size cap, sliding-window rate limiter, secure headers, unified error
  envelope via `zv` wrapper around `@hono/zod-validator`). Routes:
  `/v1/auth/otp` (sim + Twilio + MSG91 drivers, demo-mode live-display),
  `/v1/payments` (Razorpay sim + live with exact state machine,
  idempotency, webhook verification), `/v1/vin` (real NHTSA vPIC call),
  `/v1/safety`, `/v1/wellbeing`, `/v1/eta` (Routes API v2), `/v1/intake`,
  `/v1/dispatch`, `/v1/autonomy`, `/v1/phm`, `/v1/fusion`, `/v1/llm`
  (diagnostic), `/v1/concierge/turn` (SSE driving the LangGraph
  supervisor), `/v1/bookings/:id/stream` (Maister-aligned SSE timeline),
  `/v1/me/consent` (DPDP delete flow).
- **`apps/web`**: Next.js 16 + React 19 + React Compiler + Tailwind 4 +
  next-intl 4. AAA-contrast demo banner, 3-card home, 4 + 1 step
  `BookingWizard` that ends by streaming a live concierge `AgentEvent`
  trace, `/status/[id]` live ticker subscribing to the booking SSE,
  `/autonomy/[id]` dashboard, `/me/consent` toggles. Strict CSP via the
  Next.js `proxy.ts` convention. Full en + hi i18n with room for nine
  Indic languages.
- **`infra/terraform`**: GCP baseline for `asia-south1` — Cloud Run x 2,
  Firestore, Secret Manager, Artifact Registry, IAM, 25 GCP APIs
  enabled, Workload Identity Federation.
- **CI**: GitHub Actions pipeline — lint, typecheck, test, build, Trivy
  SBOM + vuln scan, WIF-auth'd Cloud Build deploy.
- **Dual-region posture**: India (`asia-south1`) primary for DPDP,
  US (`us-central1`) secondary for CCPA/CPRA.
- **Test suite**: 125 unit tests across `@vsbs/shared` (73), `@vsbs/sensors` (17), `@vsbs/api` (35).
- **Smoke suite**: 25 live HTTP tests against the running API.

### Security

- Strict, nonce-based CSP without `unsafe-inline`.
- HSTS 2 years preload.
- Post-quantum hybrid envelope for long-lived secrets (ML-KEM-768 + X25519 in Cloud KMS).
- Rate limit per (ip, matched-route) with `retry-after`.
- Idempotency keys required on all money-moving endpoints.
- `CommandGrant` tokens cryptographically bound to auto-pay cap so a compromised server cannot exceed the owner's signed ceiling.

### Fixed

- `IndiaPlateSchema` ordering bug where `.max(12)` ran before
  whitespace normalisation, rejecting `DL 1C AB 1234`.
- NHTSA `DecodeVinValues` adapter schema mismatch (flat-keyed row
  vs. `Variable`/`Value` pairs).
- Concierge route `apiBase` double-`/v1` prefix against the tool
  registry, causing 404 on every tool call.

### Known limitations

- `@vsbs/shared` cannot be bundler-imported from `apps/web` today
  (Next.js rejects the `.js` specifiers); a local mirror of
  `ConsentPurpose` is used in `/me/consent`. Workaround:
  `transpilePackages: ['@vsbs/shared']`.
- Autonomy tier A (Mercedes/Bosch AVP) plug-in is scoped but needs an
  OEM key to exercise live.
- Repair knowledge graph (AlloyDB + pgvector + Vertex Vector Search)
  is designed but not ingested.
- Voice intake via Gemini Live API is documented but not wired.

---

[Unreleased]: https://github.com/divyamohan1993/vsbs/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/divyamohan1993/vsbs/releases/tag/v0.1.0

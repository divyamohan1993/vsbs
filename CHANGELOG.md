# Changelog

All notable changes to VSBS are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it tags `v1.0.0`.

## [Unreleased]

### Added

- **Live L5 sensor stream → autonomy dashboard.**
  - `apps/api/src/adapters/autonomy/live-hub.ts`: per-booking pub/sub
    with 100-frame and 50-event ring buffers. `LiveTelemetryFrameSchema`
    (Zod) covers the full surface a Tesla FSD HW4 / Waymo 6 / Mobileye
    Chauffeur / Wayve stack publishes off-vehicle: 8 surround cameras,
    4× 4D imaging radars, solid-state LiDAR, LWIR thermal, 8-mic audio
    array, multi-constellation GNSS + RTK (GPS / GLONASS / Galileo /
    BeiDou / NavIC), 9-DoF IMU, per-corner wheels (rpm + TPMS + tyre
    temp + brake-hub temp), steering + brake pressure + air-suspension
    ride height, motors (front + rear with stator + rotor temps), HV
    pack with cell-level voltage/temp + isolation resistance + SoP / SoH
    + three coolant loops, AURIX lockstep + HSM heartbeat, 5G NR-V2X +
    MEC RTT + HD-map sync, V2X bus (BSM / SPaT / MAP / CAM / DENM / RSA),
    ODD compliance + Mahalanobis OOD score + UNECE R157 ladder +
    capability budget + MRM, DMS + cabin air, environment, perception
    detections + tracks + BEV occupancy + lane graph, planner CVaR +
    behaviour, software versions.
  - `synthetic-frame.ts`: deterministic L5 fallback that fills every
    channel with research-grade values when the bridge is silent.
  - `apps/api/src/routes/autonomy.ts`: new endpoints
    `POST /v1/autonomy/:id/telemetry/ingest`,
    `POST /:id/events/ingest`,
    `GET /:id/telemetry/sse`,
    `GET /:id/events/sse`. SSE consumers replay the most recent cached
    frames so a fresh subscriber lands on a populated dashboard.
- **Dashboard L5 sensor suite.** `apps/web/src/components/autonomy/SensorSuite.tsx`
  renders 12 dense sections: sensor census, BEV occupancy mini-map with
  class-coded tracks + risk halos, tracks table, GNSS + IMU, vehicle
  dynamics, powertrain with 96-cell heat-map, compute + lockstep + HSM,
  network, V2X, safety / SOTIF / R157, cabin + DMS, environment,
  software footer. `PerceptionEventLog.tsx` streams the events SSE as a
  40-line tail with category + severity colour-coding.
- **CARLA bridge integration.** `VsbsApi.autonomy_telemetry()` and
  `.autonomy_event()` helpers in `tools/carla/vsbs_carla/api.py` so the
  existing live CARLA bridge feeds the dashboard the moment it runs on a
  GPU-equipped host.
- **GPU-free chaos scenario driver.**
  `tools/carla/vsbs_carla/scripts/run_chaos_demo.py` pushes 10 Hz frames
  + a 21-event scripted timeline (red light → pedestrian dart-out at
  14 m → R157 rung 1 → drive-belt fault progression → OOD over 0.92
  threshold → R157 rung 2 → MRM lateral-creep-to-shoulder →
  Mercedes-Bosch IPP handshake → AVP slot acquired → service complete →
  returned home). Wire-identical to the live CARLA bridge.

### Fixed

- **Strict CSP was blocking every inline style attribute** on JSX, which
  broke all `--hero-bg` / `--autonomy-bg` CSS-variable image carriers.
  `style-src` now permits `'unsafe-inline'` while keeping nonce +
  strict-dynamic on `script-src`. Hero images, dashboard backdrops, and
  BEV overlays now render. Reported as "*.png files only one image
  loaded".
- **Tailwind 4 `text-[var(--text-…)]` arbitrary classes silently
  collapsed to 16 px.** Rewrote 211 callsites to
  `text-[length:var(--text-…)]` with the explicit length type hint.
  Hero h1 went from 16 px to 96 px, h2 to 40 px, KPI numerals to 52 px.
- **`/api/_/csp-report` 404 storm** — added a Next.js route handler that
  absorbs CSP violation reports with 204 No Content.
- **`/favicon.ico` 404** — removed the explicit metadata override and
  added a 32 × 32 brand-mark favicon at `app/favicon.ico` plus the
  ImageResponse-based `app/icon.tsx`.
- **`/api/proxy/web-vitals` 404** — corrected the default endpoint in
  `apps/web/src/lib/telemetry.ts` to `/api/proxy/metrics/web-vitals`.
- **Hydration mismatch on the autonomy dashboard** — `CameraTile` clock
  and `FALLBACK_GRANT.issuedAt` now seed from a deterministic constant
  and only fill the wall-clock value after mount.
- **Service-worker `Cache.put` NetworkError** on SSE responses — added
  `isCacheable()` to skip `text/event-stream`, opaque, and non-2xx
  responses; bumped SW version to `vsbs-sw-2`.
- **Web Vitals beacons tripped the per-IP rate limiter under HMR** —
  reporter coalesces samples into a single batched beacon flushed on
  `visibilitychange:hidden` / `pagehide`, dev sample rate dropped to 0,
  and `/v1/metrics/*` got its own 600 rpm envelope.
- **CARLA bridge ingest was rate-limited at 120 rpm.** Path-aware
  dispatcher in `apps/api/src/server.ts` carves out
  `/v1/autonomy/.../telemetry/ingest` (2 000 rpm),
  `/v1/autonomy/.../events/ingest` (600 rpm), and `/v1/metrics/*`
  (600 rpm) so a single request only ticks one bucket.
- **Hero PNGs were 6.0 – 8.2 MiB each (66 MiB total).** Converted to
  WebP at quality 78 with a 2 400 px max dimension. Total payload down
  to 1.4 MiB (-98 %). All 6 source files updated to `.webp` URLs.

### Witness

- `docs/verification/2026-05-01-web-ui-fix.md` — full witness with
  before/after console-error counts per route, network probe results,
  test-suite summary (991 unit tests, 22 Playwright e2e on Chromium /
  Firefox / WebKit, all 15 packages typecheck clean), and screenshots of
  the chaos scenario at multiple scenario phases.

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

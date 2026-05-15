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
- **Cloud Run images never actually built.** Three latent defects kept
  `apps/api/Dockerfile` and the workspace build from producing a
  deployable artefact, exposed when we first ran `gcloud builds submit`:
  - The API builder used `oven/bun:1.2`, which ships without Node or
    corepack; `RUN corepack enable` returned 127. Switched the builder
    to `node:22-alpine` and added a curl-based Bun install on top
    (Bun's musl/Alpine binary is shipped officially), preserving the
    Bun runtime stage.
  - `bun build` cannot bundle pino's `thread-stream` worker entry
    (loaded via runtime path resolution), so the bundled `dist/server.js`
    crashed on first log with `ModuleNotFound resolving …thread-stream
    …/worker.js`. The runtime image now ships the full source tree plus
    `node_modules` and runs `bun run src/server.ts` directly — Bun's
    native TypeScript + workspace resolver picks up the symlinked
    `@vsbs/*` packages, and pino's worker scripts are reachable.
  - The root `build:libs` script only compiled five of the eight library
    packages, leaving `@vsbs/telemetry`, `@vsbs/agents`, and
    `@vsbs/security` without `dist/` outputs; the API bundle could not
    resolve `@vsbs/telemetry` at all. Filter list now covers every lib.
- **`deploy/cloudbuild.yaml` rejected by Cloud Build.** The
  `_REGION_SHORT` substitution was declared but never referenced in any
  step, and `dynamicSubstitutions: true` made that fatal. Removed.
- **"Start autonomous test drive" was a local-dev landmine.**
  `/v1/scenarios/test-drive/start` tried to `Bun.spawn()` a Python venv
  binary at a hardcoded absolute Windows path
  (`C:\Users\SPANDAN\Downloads\vsbs\tools\carla\.venv\Scripts\python.exe`)
  belonging to a different machine entirely. On Cloud Run that path
  doesn't exist, so the route always returned
  `500 BRIDGE_SPAWN_FAILED`. Rewrote the route to delegate to the
  chaos-driver Cloud Run service over HTTP: API → `POST {CHAOS_DRIVER_URL}/run`
  with the API's own `apiBase` and the bookingId; the driver runs the
  scripted 5-minute scenario and POSTs telemetry + perception events back.
  The in-memory queue still serialises double-clicks. The SSE log-tail
  endpoint became a stub (one informational event, then close) since the
  chaos driver runs in a different container and Cloud Logging owns its
  stdout. Local Windows paths and `Bun.spawn` are gone from runtime.
- **Chaos driver POSTs were rejected `401 VEHICLE_TOKEN_INVALID`.**
  The autonomy ingest endpoints (`/v1/autonomy/:id/telemetry/ingest`,
  `/events/ingest`) require an `x-vsbs-vehicle-token` HMAC over
  `${bookingId}.${b64url(sha256(body))}` keyed by `SESSION_SIGNING_KEY`.
  `run_chaos_demo.py` was POSTing raw `client.post(..., json=frame)`
  with no auth header, so the API silently dropped every frame. The
  script now mints the HMAC per request (same code-path as
  `VsbsApi.autonomy_telemetry`) and reads the key from
  `SESSION_SIGNING_KEY` / `VSBS_SESSION_SIGNING_KEY`. Both services on
  Cloud Run now share the key via env var.
- **Live event log stayed on "AWAITING STREAM" — three categories silently
  dropped at the API.** `PerceptionEventSchema` in
  `apps/api/src/adapters/autonomy/live-hub.ts` enumerated nine categories;
  the chaos scenario emits three more that the live CARLA bridge would
  also produce (`compute` — HSM / AURIX lockstep / perception-model
  warm-up, `compliance` — ODD admission + DPDP consent, `regulatory` —
  ASIL-D + R157 rung). Every one of those returned `400
  VALIDATION_FAILED` at ingest, so the event log saw nothing from the
  first ~30 s of the timeline (where the bulk of cold-start chatter
  lives). Expanded the enum to include all 12 categories; type-only
  parity update in `usePerceptionEvents.ts`.
- **Chaos driver uses the user's *live* geolocation.** The "Start
  autonomous test drive" button now requests `navigator.geolocation`
  before POSTing, sends `{lat, lng}` in the body, the API forwards
  them to the chaos driver's `/run` endpoint, and the chaos driver
  uses them as both the Open-Meteo fetch coordinates AND the GPS
  reference for the integrated route. Permission denial / network
  timeout / no-geolocation-API all fall back to Bangalore
  defaults — scenario never fails to start. The UI shows a one-line
  privacy note under the button.
- **Weather cache: 2 hours, 10 km diameter (5 km haversine radius),
  per Cloud Run instance.** A request from anywhere inside an
  already-cached 5 km radius and younger than 2 h reuses the
  Open-Meteo payload — only the lat/lng anchor swaps to the caller's
  exact coordinates so GPS frame derivation stays accurate. Bounded
  to 128 entries with oldest-first eviction. Easily survives the
  free-tier 10 000 calls/day Open-Meteo cap. Verified in production:
  three NYC test-drives within 3 km of each other -> 1 network fetch,
  2 cache HITs.

- **Chaos driver gains live weather + extended physics + wear/RUL projector.**
  Building on the physics-coupled rewrite below, the simulator now:
  - **Pulls real-time weather + air-quality from Open-Meteo** (no key,
    free tier, ~200 ms RTT) at scenario start, falling back to a sane
    Bangalore default if the network is unreachable. Ambient temp,
    humidity, wind speed/direction, pressure, cloud cover, WMO weather
    code, day/night, visibility, UV index, PM2.5, PM10 are all fetched
    and seeded into the vehicle state.
  - **Solar irradiance** via Cooper formula for declination + spherical
    astronomy for altitude, then DNI modulated by cloud cover (~1100
    W/m² at zenith on a clear day, ~250 W/m² overcast at noon, 0 at
    night). Pavement temperature heats above ambient under sun.
  - **Cabin thermal balance**: solar gain through 4 m² of tinted glass
    + 18 m² of bodywork (absorptance 0.55) heats the cabin; conduction
    through insulation (28 W/K) lets ambient bake or chill it; one
    occupant adds 115 W sensible heat. HVAC compressor (peak 6 kW,
    Carnot-derated COP that drops from 3.4 at 25 °C ambient to 2.0 at
    50 °C) fights all of that.
  - **HVAC + auxiliary loads on the HV pack**: compressor watts, blower
    350 W, electronics 850 W (+200 W at night for lights) — the pack
    discharges even at idle. Sit in a 50 °C jam with AC on and the SoC
    drops while the motor sits at 0 RPM. Regen disables above 95% SoC
    and below 5 °C cell temp.
  - **Wind-aware drag**: ground speed + headwind component → effective
    airspeed → `½·ρ·Cd·A·v²`. Crosswind component computed too (used
    for future suspension modelling).
  - **Pavement-state-dependent traction**: `μ` = 0.88 dry, 0.58 wet,
    0.30 snow. Effective drive/brake forces are capped at `μ·m·g` —
    ABS-equivalent. Rolling resistance multiplies by 1.25× on wet,
    1.6× on snow.
  - **Real-air-density** from ideal gas at ambient temp + pressure (not
    a fixed 1.225 kg/m³). High-altitude or hot-ambient drives use less
    drag than sea-level cool conditions, by the right amount.
  - **CO₂ recirc model**: with recirc on (default), cabin CO₂ climbs
    toward 1500–2000 ppm in a 10-min jam — physically accurate, the
    same effect that drives driver fatigue in stop-and-go traffic.
    Fresh-air mode ventilates aggressively; the value drops within seconds.
  - **PM2.5 cabin filter**: 90% reduction from outside PM2.5 (HEPA-grade
    automotive filter). Off-AC, equilibrates with outside air.
  - **Battery State-of-Power derating**: hot cells (>30 °C) AND cold
    cells (<10 °C, ionic mobility floor) both lower SoP. Isolation
    resistance drops with humidity + cell temp.
- **Wear & remaining-useful-life (RUL) projector.** Pure observer that
  reads the vehicle state each tick and projects when each component
  will hit its end-of-life threshold under the *currently observed*
  operating regime — projections recompute every tick as the regime
  shifts. Components tracked:
  - **Brake pads (per wheel)**: wear rate derived from observed %
    drop; EOL at 15%; surfaces % current, %/s rate, RUL hours/km,
    ok/watch/alert severity.
  - **Tires (per wheel)**: physics-driven wear model — base 1.2e-4
    mm/km, multiplied by lateral g^1.5 (×4.5 max), longitudinal g
    (×2.0 max), hot-tyre factor (above 80 °C), pavement state
    (1.4× wet, 0.7× snow). EOL at 1.6 mm legal minimum; surfaces
    tread mm, mm/s wear rate, RUL hours/km.
  - **Battery SoH**: NCA-pouch literature — 0.005% drop per
    equivalent-full-cycle, doubled every +15 °C above 30 °C
    (Arrhenius rule of thumb). Projects time to 80% warranty floor
    and 70% practical replacement.
  - **Motor bearings**: simplified L10 contribution scaling with
    `RPM · torque^(10/3)` (SKF ball-bearing exponent). Projects
    hours used / RUL hours / fraction-consumed.
  - **Inverter capacitors**: Arrhenius (life halves every +10 °C
    above 70 °C) × ripple² stress.
  - **Coolant**: operating hours (changeover at 8000 h).
  Surfaced on the frame as a passthrough `wear` block so the dashboard
  PHM panel renders it without any schema changes. Endpoints, wire
  shape, and HMAC signing are byte-identical to what the live CARLA
  bridge already produces — hooking up CARLA is one line of config.
- **Cloud Build moved to free-tier machine.** Dropped
  `machineType: E2_HIGHCPU_8` from all four cloudbuild configs
  (`deploy/cloudbuild.{yaml,api.yaml,web.yaml}` +
  `tools/carla/cloudrun/cloudbuild.yaml`). Default `e2-standard-1`
  is included in the free 120-build-min/day allowance. Builds take
  ~2× longer but cost zero.

- **Chaos driver was a sin-wave puppet, not a vehicle.** Every observable
  was computed inline from `t` and `random()` — speed from a scripted
  profile, brake-pad % from a linear decay, motor temps from
  `64 + speed_kph * 0.18`, cell voltages from `3650 + sin(t/24)`. Speed
  could read 100 kph while brake temp sat at room temperature and the
  HV pack drew zero current. Replaced with a stateful physics integrator
  (`VehicleState` + `step_physics`) that drives every channel from a
  single source of truth:
  - **Newton II** longitudinal force balance: `F_drive` (throttle ·
    motor torque / wheel radius) − `F_brake` − drag (½·ρ·Cd·A·v²) −
    rolling resistance − grade → integrated acceleration → speed.
  - **Bicycle-model** lateral kinematics: yaw rate = (v · tan(steer)) /
    wheelbase; heading integrates yaw rate.
  - **Powertrain heat**: motor I²R loss = P_motor · (1 − η);
    inverter loss = I² · R_eq; both dissipate into the motor coolant
    loop. Stator and rotor temps track separately.
  - **Brake heat**: dissipated power = F_brake · v per wheel
    (65 % front bias); air cooling scales linearly with road speed;
    pad wear ∝ brake² · v with thermal-fade multiplier above 200 °C.
  - **Battery**: SoC = SoC − ∫P_motor dt / capacity; per-cell voltage
    = OCV(SoC) − I·R_internal with one weak cell that sags harder
    under load; cell heat = I²R minus conduction to battery coolant.
  - **Tires + TPMS**: rolling-friction heat + hub conduction; pressure
    follows ideal gas (P/T = const) from the integrated tire temp.
  - **Coolant loops**: radiator effectiveness scales with airflow (i.e.
    speed), so a stationary car heats up faster than one cruising.
  - **Cabin**: CO₂ rises from one occupant breathing; ventilation
    chases it down, faster at higher speed.
  - **HV SoP / isolation**: degrade with hot cells.
  Scripted scenario events (red light at 75 s, pedestrian dart-out at
  180 s, MRM at 295 s) now act as control INPUTS through a P-cruise
  controller — they set throttle/brake/steering targets and physics
  produces consistent observables. The wire shape
  (`LiveTelemetryFrameSchema`) is unchanged; swap in a real CARLA bridge
  and the dashboard sees the same field set with the same semantics.

- **Autonomy dashboard panels were silent (no telemetry, no events).**
  The browser fetches `/v1/autonomy/:id/telemetry/sse` (and the events
  SSE) through Next.js's proxy, which strips `Authorization` and
  `Cookie` headers as defense-in-depth. Both SSE routes used
  `requireSession`, so every anonymous test-drive subscription failed
  with `401 SESSION_REQUIRED` before reaching the handler — the
  dashboard would render the frozen placeholder forever. Replaced
  `requireSession` with `optionalSession` on the three dashboard read
  paths (`telemetry/sse`, `events/sse`, `booking/:id/grant`). The
  post-handler check `if (owner !== null && owner !== ownerSubject)`
  still returns 403 for *claimed* bookings, so owner protection is
  preserved; only unclaimed test-drive bookings (whose URL is the
  capability) become anonymously readable. Verified end-to-end against
  the live deploy — both telemetry and perception events stream to a
  no-auth curl through `vsbs.dmj.one/api/proxy/...`.

### Added

- **Single-service Cloud Build configs.**
  `deploy/cloudbuild.api.yaml` and `deploy/cloudbuild.web.yaml` build
  and push one image each (asia-east1 Artifact Registry,
  `cloud-run-source-deploy` repo). Lets you iterate on one container
  without rebuilding the other; intended for hot-fix paths.

### Deployed

- `vsbs-web` (Cloud Run, asia-east1) → `https://vsbs.dmj.one` — Next.js
  16 web app, demo banner on, proxies `/api/proxy/*` to
  `https://api.vsbs.dmj.one`.
- `vsbs-api` (Cloud Run, asia-east1) → `https://api.vsbs.dmj.one` — Hono
  on Bun, `NODE_ENV=development` so sim-mode env passes the strict
  production gate. All `_MODE` toggles set to `sim` / `mixed`,
  `LLM_PROFILE=sim`, freshly generated `SESSION_SIGNING_KEY` and
  `IDENTITY_PLATFORM_SIGNING_KEY` (≥ 32 bytes).
- `vsbs-chaos-driver` (Cloud Run, asia-east1) → `https://chaos.vsbs.dmj.one`
  — unchanged container; only the public DNS subdomain moved off the
  apex so the product lives at `vsbs.dmj.one`.

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

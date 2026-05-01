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
| Live L5 telemetry hub (per-booking pub/sub, ring-buffered, fed by CARLA bridge or chaos driver) | `apps/api/src/adapters/autonomy/live-hub.ts` + `synthetic-frame.ts` | Complete |
| L5 sensor schema (8 cameras, 4× 4D imaging radar, LiDAR, thermal, audio array, multi-constellation GNSS+RTK, IMU, V2X bus, 96-cell HV pack, OOD/SOTIF, R157 ladder, DMS) | `apps/api/src/adapters/autonomy/live-hub.ts` `LiveTelemetryFrameSchema` | Complete |
| L5 dashboard sections (sensor census, BEV occupancy + tracks, GNSS, dynamics, powertrain cells, compute + lockstep + HSM, network, V2X, safety, cabin, env, software footer, live event log) | `apps/web/src/components/autonomy/SensorSuite.tsx` + `PerceptionEventLog.tsx` | Complete |
| GPU-free chaos scenario driver (wire-identical to CARLA bridge: red light → pedestrian dart-out → R157 → MRM → IPP handshake) | `tools/carla/vsbs_carla/scripts/run_chaos_demo.py` | Complete |

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

## Phase 4 (dual-region) — what is now real

| Area | What's shipped | Notes |
|---|---|---|
| Per-region Terraform module | `infra/terraform/modules/region/{versions,variables,main,region-router,outputs}.tf` | Cloud Run × 3 (api, web, region-router), Firestore (regional, PITR on, delete-protected), Secret Manager with explicit replicas, Artifact Registry, regional logging sink to BigQuery, serverless NEGs, regional backend services with Cloud CDN on web. |
| Per-region wrappers | `infra/terraform/regions/{india,us}/main.tf` | India pins to `asia-south1`, replicas empty (DPDP-residency). US pins to `us-central1` with `us-east1` DR replica. |
| Global edge | `infra/terraform/global/{versions,variables,main}.tf` | Cloud DNS managed zone (DNSSEC on), global anycast IP, A records for the six FQDNs, managed SSL cert covering all six, host-based URL map, Cloud Armor with OWASP CRS 4.0 + bot management + per-IP rate limit (100 r/min on `/v1/auth/otp`), HTTP→HTTPS redirect, modern SSL policy. |
| Region-router service | `infra/terraform/modules/region/main.tf` (Cloud Run) + `infra/terraform/modules/region/region-router.tf` (IAM, log-based metric) | Runs in each region, fronted by the global LB, 302s users to the correct regional FQDN; logic shared with the API middleware. |
| Cross-region observability | `infra/terraform/observability.tf` | Central BigQuery dataset (90-day retention, region label preserved on every row), per-region uptime checks, aggregated dashboard JSON (request latency p50/p95/p99 by region, 5xx rate by region, Cloud Armor blocks by rule). |
| API region pinning middleware | `apps/api/src/middleware/region.ts` | Reads `x-vsbs-region`, GCP geo headers, `cf-ipcountry`, sticky cookie. Maps country → region. EU-block path returns 451. Vary headers emitted. 13 unit tests. |
| API residency assertion middleware | `apps/api/src/middleware/region-residency.ts` | Asserts pinned region matches runtime; 308s to the correct regional FQDN on mismatch. Health probes pass through. 3 unit tests. |
| Identity Platform tenant abstraction | `apps/api/src/adapters/identity-platform.ts` | Sim driver (HMAC-derived tenant ids, in-memory token store, deterministic) + live driver (Firebase Admin SDK shape). 11 unit tests. |
| Region router adapter | `apps/api/src/adapters/region-router.ts` | Env-driven map of region → API/web base URL. 5 unit tests. |
| Region routes | `apps/api/src/routes/region.ts` | `GET /v1/region/me` + `POST /v1/region/switch` (409 on pending bookings) + `DELETE /v1/region/cookie`. 6 unit tests. |
| Web region UI | `apps/web/src/app/region/page.tsx` + `apps/web/src/components/region-switcher.tsx` | CSP-clean (no inline scripts), AAA-contrast button, en + hi i18n. |
| Operator runbook | `docs/runbooks/region-failover.md` | In-region failover (revision rollback, Firestore PITR) + cross-region degraded mode (DPDP-aware, no cross-region routing of personal data). |

## Next steps (ordered)

1. Wire the Claude Managed Agents client + tool registry (`packages/agents`).
2. ~~Ingest NHTSA recalls + generic DTC corpus into AlloyDB + Vertex Vector Search.~~ **DONE — Phase 3 complete (see below).**
3. Ship the voice-intake Chirp-3 route.
4. Stand up admin SIEM Next.js route under IAP.
5. Add Playwright + axe-core CI.
6. Run a DPIA + FRIA before enabling `AUTONOMY_ENABLED=true`.
7. Provision a third region (`europe-west4`) to drop the EU-block fallback and serve EU users locally.

## Phase 3 complete (2026-04-28) — Knowledge base + retrieval

| Capability | File | Status |
|---|---|---|
| AlloyDB + pgvector hybrid client interface | `packages/kb/src/alloydb.ts` | `KbClient` interface + `InMemoryKbClient` sim driver. BM25 lexical (Robertson-Walker), HNSW-shaped dense ANN (cosine on normalised vectors), Reciprocal Rank Fusion (Cormack 2009, k=60). Deterministic on tie. |
| BGE-M3 multilingual embedder | `packages/kb/src/embeddings.ts` | Sim driver: SHA-256 deterministic 768-dim dense, 32 768-vocab sparse, per-token ColBERT. L2-normalised dense; same input always produces the same vectors. Live driver swap is one constructor line. |
| GraphRAG ingestor | `packages/kb/src/graphrag.ts` | Token budget 50 k, sentence segmentation with abbreviation guard, deterministic entity extractor (DTC, TSB, ICON_*, vehicle year-first OR year-last, automotive system keywords, OEM), pairwise co-occurrence triples. |
| OBD-II DTC corpus | `packages/kb/src/dtc-corpus.ts` | 220+ real SAE J2012-DA / ISO 15031-6 codes spanning P00xx-P02xx, P03xx, P04xx, P05xx, P06xx, P07xx, P08xx, P0Axx, plus B/C/U samples. O(1) Map lookup. Provenance manifest (source, version, license, retrieved-at). |
| ISO 2575 tell-tale registry | `packages/kb/src/iso2575.ts` | 40+ canonical icons (red/amber/green/blue/white) with severity 1-3, category, ISO clause reference. O(1) Map lookup, severity filter. |
| Indic NLP pipeline | `packages/kb/src/indic-nlp.ts` | All 10 Indian script Unicode-block detectors (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, plus Latin) + a curated 10-term automotive glossary covering 12 languages (en, hi, bn, ta, te, kn, ml, gu, pa, or, as, mr). Deterministic 768-dim embedding. |
| OEM manual plug-in registry | `packages/kb/src/oem-plugin.ts` | Tenant-scoped, EULA-gated, per-`(tenantId, oem)` keying. Built-in `EmptyOemProvider` (proves the gate) and `GenericNhtsaTsbProvider` (real public-domain NHTSA TSB summaries). |
| API surface | `apps/api/src/routes/kb.ts` | `POST /v1/kb/search` (hybrid + OEM plug-in citations), `POST /v1/kb/ingest` (GraphRAG), `GET /v1/kb/dtc/:code`, `GET /v1/kb/telltale/:id`, `GET /v1/kb/health`. All schema-validated through `zv()`. Mounted in `apps/api/src/server.ts`; `/readyz` exposes `checks.kb`. |
| Tests | `packages/kb/tests/` | 62 unit tests passing across embeddings (8), alloydb hybrid+RRF (9), DTC corpus (6), ISO 2575 (6), Indic NLP (18), GraphRAG (7), OEM plugin (8). |
| Research doc | `docs/research/knowledge-base.md` | 12 sections, 17 cited sources covering pgvector 0.7, AlloyDB Omni, BGE-M3, GraphRAG, RRF, IndicTrans2, IndicBERT v2, SAE J2012-DA, ISO 2575, ISO 15031-6, UNECE R121, NHTSA TSB API. |

## Phase 6 complete (2026-04-28) — Security hardening

| Capability | File(s) | Status |
|---|---|---|
| Hybrid PQ KEM (X25519 + ML-KEM-768, FIPS 203) | `packages/security/src/pq.ts` | Real `@noble/post-quantum` ML-KEM-768 + `@noble/curves` X25519. HKDF-SHA-256 combiner per RFC 9180 shape. Public key 1184+32, ciphertext 1088+32, shared secret 32. 7 unit tests. |
| ML-DSA-65 signer (FIPS 204) | `packages/security/src/sig.ts` | Real `@noble/post-quantum` ml_dsa65. PK 1952, SK 4032, sig 3309. `verify()` is non-throwing. 6 unit tests. |
| Cloud KMS PQ envelope encryption | `packages/security/src/kms-envelope.ts` | Sim driver with full hybrid KEM + AES-256-GCM round-trip; live driver shape with `LiveKmsClient` adapter for Cloud KMS PQ keys. Round-trip, rotation, and tag-tamper tests pass. 5 tests. |
| WebAuthn passkey (W3C Level 3) | `packages/security/src/webauthn.ts` | Pure WebCrypto ES256 / EdDSA Ed25519 / RS256. Real CBOR (RFC 8949) decoder + canonical encoder. COSE_Key (RFC 8152) -> JWK. ECDSA DER -> raw conversion for WebCrypto verify. Deterministic registration + assertion fixtures via the algorithms themselves. UP/UV flag enforcement, signCount monotonicity, rpIdHash check. 5 tests. |
| Passkey ↔ CommandGrant bridge | `packages/security/src/command-grant-passkey.ts` | Verifies WebAuthn assertion bound to canonical grant bytes; ML-DSA-65 witness co-signs the grant; merges signature into `witnessSignaturesB64`. 4 tests. |
| Secret rotator (Secret Manager + KMS shape) | `packages/security/src/secrets.ts` | Versioned ring (current, previous, n-2). Built-in generators: 32-byte HTTP auth, 32-byte webhook signing, 24-char database password (rejection sampling, zero modulo bias) over `[A-Za-z0-9!@#$%^&*]`. 30 d default cadence enforced via `due()` + `sweep()`. 7 tests. |
| PII redaction engine | `packages/security/src/pii-redaction.ts` | Real Verhoeff (Aadhaar), Luhn (credit-card), state-code-allow-listed Indian VRN, ISO 3779 VIN, PAN, IFSC, IPv4/IPv6, GPS (full-redact for log, ~1 km grid quantise for LLM). `redactForLog` and `redactForLLM`. Each redactor has a positive case + a negative case (e.g. 12-digit string failing Verhoeff is NOT Aadhaar). 18 tests. |
| CSP nonce + builder | `packages/security/src/csp.ts` | Strict, nonce-based CSP. `buildCspHeader({nonce, region})` + `buildSecurityHeaders` for HSTS, nosniff, referrer-policy, COOP, permissions-policy. Region-aware connect-src. Hash-based fallback supported. 6 tests. |
| Sliding-window rate limiter | `packages/security/src/rate-limit.ts` | Approximate sliding-window across cur+prev bucket weighted by elapsed/window. Pluggable store: `MemoryStore` and `ValkeyStore` (adapter to a `ValkeyClient` interface). Per-route override (exact + regex prefix). Per-IP / per-user / per IP+user keying. 5 tests. |
| API integration: PII-redacting logger | `apps/api/src/middleware/pii-redaction.ts` | Wraps `Logger` so every `info/warn/error/child` redacts fields before they hit the structured log. 3 unit tests. |
| API integration: WebAuthn passkey routes | `apps/api/src/routes/passkey.ts` | `POST /v1/auth/passkey/register/{begin,finish}` + `/auth/{begin,finish}`. All payloads schema-validated. Mounted in `server.ts`. 3 unit tests through Hono. |
| API integration: Cloud Armor verdict middleware | `apps/api/src/middleware/cloud-armor.ts` | Reads `x-cloud-armor-action` header, fails closed on `block` (403), `challenge` (401), throttled traffic stamped with `x-edge-throttle`. 7 unit tests. |
| Terraform — Cloud Armor + reCAPTCHA + Binary Auth + VPC-SC | `infra/terraform/security.tf` | Real `google_compute_security_policy` with OWASP CRS 4.x preconfigured rules (sqli/xss/lfi/rce/rfi/scanner/protocol/session-fixation), per-IP rate-based ban (200/min, ban 1000/600s for 10 min), Adaptive Protection L7-DDoS. reCAPTCHA Enterprise key. Binary Authorization policy + Sigstore attestor (`vsbs-release`). VPC-SC perimeter for asia-south1 prod data plane. |
| GitHub workflow — security scanning | `.github/workflows/security.yml` | Real action versions: `aquasecurity/trivy-action@0.32.0` (fs scan + CycloneDX SBOM, fail on CRITICAL/HIGH), `google/osv-scanner-action@v2.0.2`, `pnpm audit --audit-level=high --prod`, Semgrep CI with OWASP Top 10 + JS/TS/Node/React/Secrets/Security-Audit rule packs. All upload SARIF to GHAS Code Scanning. Daily schedule at 05:23 UTC + every PR + push to main. |
| Threat model | `docs/security/threat-model.md` | STRIDE per asset across 9 critical assets (CommandGrant, owner passkey, witness ML-DSA key, authority chain, telemetry, customer PII, auto-pay cap, OEM tokens, admin SIEM); compound-flow walkthrough; out-of-scope statement. |
| Key inventory + rotation schedule | `docs/security/keys.md` | 13 keys catalogued: ML-DSA-65 witness + release, ML-KEM-768+X25519 KEKs (PII / refresh / OEM), AES-256-GCM DEKs, EdDSA JWT, HMAC-SHA-256 region + webhook + OTP, db password. Cadence rationale tied to NIST SP 800-57 + research §5. Failure-mode + recovery table. |
| Tests | `packages/security/tests/` + `apps/api/src/{middleware,routes}/*` | **63 unit tests in `@vsbs/security`** (pq 7, sig 6, kms-envelope 5, webauthn 5, command-grant-passkey 4, secrets 7, pii-redaction 18, csp 6, rate-limit 5). **+13 in `@vsbs/api`** (passkey 3, cloud-armor 7, pii-redaction 3). |


## Phase 7 complete (2026-04-28) - Observability + operations

| Capability | File(s) | Status |
|---|---|---|
| @vsbs/telemetry package | `packages/telemetry/src/{otel,logger,metrics,health,slo,index}.ts` | New package. OTel SDK (BasicTracerProvider + WebTracerProvider) with OTLP HTTP exporter and AsyncLocalStorageContextManager for cross-await context. pino structured logger with PII redaction (phone, email, VIN, Aadhaar, 16-digit card) plus pino-redact paths. Metrics SDK with the canonical VSBS counters / histograms / gauges (`vsbs_http_requests_total`, `vsbs_http_request_duration_seconds`, `vsbs_safety_overrides_total`, etc.). HealthChecker registry with sim-and-live drivers for AlloyDB / Firestore / Secret Manager / LLM provider. SLO + multi-window burn-rate evaluator per the Google SRE workbook (14.4× / 6× / 1× thresholds). |
| Telemetry tests | `packages/telemetry/tests/{otel,logger,metrics,health,slo}.test.ts` | 43 unit tests. otel(6), logger(10), metrics(7), health(9), slo(11). All passing. |
| API OTel middleware | `apps/api/src/middleware/otel.ts` | Wraps every Hono request in a SERVER span with SemConv-aligned attributes (`http.request.method`, `http.route`, `http.response.status_code`, `service.region`). Exceptions are recorded; status code is mapped to OK/ERROR per the HTTP semantic conventions. |
| API telemetry logger middleware | `apps/api/src/middleware/log.ts` | Emits one structured log line per response (`http.request`) with `req_id, method, route, status, duration_ms, region, user_hash` plus the active `trace_id` / `span_id`. Writes through pino *and* a pluggable sink - the sink hooks the SIEM ring buffer for the live admin feed. |
| API health surface | `apps/api/src/routes/health.ts` | `/healthz` (liveness), `/readyz` (aggregated status, 503 on any unhealthy check), `/healthz/details` (admin-gated full breakdown). Wired with the four built-in dependency checks. |
| API metrics route | `apps/api/src/routes/metrics.ts` | `GET /metrics` Prometheus exposition rendered from the in-memory exporter; `POST /web-vitals` validated by Zod and logged. |
| API SIEM SSE feed | `apps/api/src/routes/admin/logs.ts` | `LogBuffer` ring with subscribe/unsubscribe; `/v1/admin/logs/recent` for backlog and `/v1/admin/logs/stream` for the SSE feed. IAP-gated via the existing `adminOnly` middleware. Filterable by `level=` and substring `q=`. Heartbeat every 15 s so proxies do not idle. |
| Web browser telemetry | `apps/web/src/lib/telemetry.ts` + `apps/web/src/lib/telemetry-boot.tsx` | PerformanceObserver-based capture of LCP, INP, CLS, FCP, TTFB. Each sample is rated against the Web Vitals thresholds, given a stable id and navigation type, and beaconed to `/api/proxy/web-vitals`. Optional WebTracerProvider + OTLP push when `NEXT_PUBLIC_OTLP_BROWSER_URL` is set. SSR-safe (window guard at every entry point). |
| Admin SIEM dashboard | `apps/admin/src/app/[locale]/(operator)/{dashboard,logs,alerts,runbooks,canary}/` | Five new pages: Dashboard (tile index), Logs (live SSE client with filter, pause, clear, AAA contrast colour scale per level), Alerts (canonical SLO + threshold tables), Runbooks (links to the operator playbooks), Canary (read-only flag table + kill-switch description). Wired into `OperatorNav`. |
| Terraform - alert policies + logging metrics | `infra/terraform/observability.tf` | Adds `google_logging_metric` for safety overrides / autonomy handoff failures / consent revocations, four `google_monitoring_alert_policy` (error rate > 1 %, p99 latency > 1 s, safety overrides > 0, autonomy handoff failures > 0.1 %), and an opt-in `google_monitoring_notification_channel` driven by `var.alert_email_address`. Existing dashboard + uptime checks preserved. |
| Operator runbooks | `docs/runbooks/{high-error-rate,high-latency,safety-override-spike,autonomy-handoff-failure,canary-rollback}.md` | Five runbooks. Each follows detect → assess → contain → fix → post-mortem. |
| Observability overview | `docs/observability.md` | Single-page operator entry. Stack diagram, spec references, span attribute table, log shape, metrics catalogue, SLO table, burn-rate thresholds, configuration variables. |

## Phase 11 complete (2026-04-28) — Quality + verification

Roadmap items 77-84 are shipped end-to-end.

| Capability | File(s) | Status |
|---|---|---|
| Property-based tests (fast-check) | `packages/shared/tests/properties/{vin,india-plate,wellbeing,payment-state-machine,intake-schema}.property.test.ts` + `packages/shared/vitest.property.config.ts` | 37 properties across VIN ISO 3779 check digit, Indian VRN parser, IntakeSchema invariants, wellbeing scorer monotonicity, payment state machine. fast-check ^3.23.2. |
| Safety regression suite | `packages/shared/tests/fixtures/safety-regression.json` + extended `packages/shared/src/safety.test.ts` | 32 historical red-flag cases (REG-001..REG-032) covering brake failure, steering loss, smoke from engine, fuel leak, electrical fire, airbag warning + collision, child safety lock failure, EV thermal, HV battery dT runaway. Driven by `it.each`. |
| Agent eval — BFCL function-calling | `packages/agents/tests/eval/bfcl-style.test.ts` + `cases/bfcl.jsonl` | 52 cases covering all 10 VSBS tools. Per-case: validates the tool name, the args via the tool's Zod schema, and a deep-subset match. Aggregate accuracy bar 90 %; current 100 %. |
| Agent eval — τ2 multi-turn | `packages/agents/tests/eval/tau2-style.test.ts` | 11 deterministic scenarios drive `runOneTurn` end-to-end with the scripted concierge: happy path, red severity, AVP eligibility, payment chain, decline, decode-then-assess, ETA + commit, sensor-only red flag, wellbeing-only, refusal-to-act, compound day-one. |
| Agent eval — red-team | `packages/agents/tests/eval/red-team.test.ts` + `cases/redteam.jsonl` | 30 cases: prompt-injection, jailbreak, unsafe-advice, PII-exfil, SQLi, XSS, system-prompt leak, story-mode jailbreak. Static layer asserts >= 50 % static detection; dynamic layer drives `runOneTurn` and asserts denylist tools never execute and forbidden text never reaches output. |
| Red-team defenses | `packages/agents/src/red-team-defenses.ts` | Three guardrails wired into `runOneTurn`: (1) `screenIncomingMessage` heuristic + sentinel-token detector (16 patterns + 17 sentinels); (2) `screenOutgoingText` PII scrubber (E.164, email, VIN, PAN-like, India VRN, system-prompt echo); (3) `screenToolCall` denylist (booking-id ownership for payment + autonomy, sentinel tokens in args). |
| Playwright e2e | `e2e/{playwright.config.ts,tests/booking-happy,booking-edge,safety-redflag,autonomy,consent,i18n,carla-replay,a11y/axe}.spec.ts` | 8 specs across Chromium + Firefox + WebKit. Auto-starts API + web. axe-core scans every public route; zero serious/critical violations gate. |
| Load tests (k6) | `load/scenarios/{booking-burst,sse-fanout,auth-otp}.js` + `load/README.md` | 200 RPS booking burst (p95 < 500 ms, error < 1 %), 1000 SSE subscribers, 100 RPS auth/otp with rate-limit observation. CI-gated to PRs labelled `load`. |
| Chaos scenarios | `chaos/{runner,scenarios/dependency-fail,db-unavailable,llm-timeout,sensor-storm}.ts` | 27 chaos tests. Toxiproxy-style `chaosWrapper` with declarative latency/error/timeout/drop schedule. Vitest-driven. |
| Quality CI workflow | `.github/workflows/quality.yml` | Six jobs: static-and-unit, agent-eval, chaos, e2e (Chromium + Firefox + WebKit + axe), lighthouse (PR-only), load (label-gated). Real action versions; SARIF + Playwright artefact uploads. |
| Quality gates documentation | `docs/quality-gates.md` | Per-merge-target gate table. Local fast-lane checklist. Bypass policy. Test counts at HEAD. |
| Root scripts | `package.json` | `pnpm test:property`, `pnpm test:agent-eval`, `pnpm test:chaos`, `pnpm test:e2e`, `pnpm test:e2e:a11y`, `pnpm test:load`. |

**Test counts at HEAD**: 51 shared unit + 37 property = 88 in `@vsbs/shared`. 17 in `@vsbs/sensors`. 35 in `@vsbs/api`. 102 agent eval (BFCL 52 + τ2 11 + red-team 30 + 9 unit/meta) in `@vsbs/agents`. 27 in `@vsbs/chaos`. e2e + load + lighthouse run in their dedicated CI jobs.

## Phase 9 complete (2026-04-28) — Mobile owner app

| Capability | File(s) | Status |
|---|---|---|
| Expo SDK 53 scaffold | `apps/mobile/{app.json,package.json,tsconfig.json,babel.config.js,metro.config.js,eas.json}` | Real Expo SDK 53 + RN 0.79 + React 19 + Expo Router 5. Bundle id `one.dmj.vsbs.owner`, deep-link scheme `vsbs://`, monorepo Metro config that watches the workspace root and resolves through pnpm symlinks. EAS profiles: development, preview, production. |
| Expo Router app | `apps/mobile/app/{_layout,index}.tsx`, `app/(auth)/login.tsx`, `app/(tabs)/{_layout,index,book,me}.tsx`, `app/(tabs)/{status,autonomy}/[id].tsx` | 8 screens. Auth → Tabs (Home, Book, Status, Autonomy, Me). Booking wizard mirrors the web 4+1 step flow with progressive disclosure + concierge SSE on confirm. Status screen consumes `/v1/bookings/:id/stream`. Autonomy screen invokes the on-device passkey flow via `requestAndSignGrant`. Me screen owns DPDP consent toggles and right-to-erasure. |
| Typed API client | `apps/mobile/src/lib/api.ts` | `VsbsApiClient` on global `fetch`, Zod-validated envelopes, idempotency-key per mutation, expo-secure-store for token + subject persistence, x-request-id, AbortController-driven timeout. Reuses `OtpStartRequestSchema`, `OtpVerifyRequestSchema`, etc. from `@vsbs/shared`. |
| Native passkey | `apps/mobile/src/lib/passkey.ts` | `react-native-passkey` 3.x platform passkey (iOS 16+ / Android 13+) + `expo-local-authentication` step-up biometric. Register / sign-in / `assertOverChallenge` for grant signing. Wired to the `apps/api/src/routes/passkey.ts` contract owned by the security peer. |
| Grant signing | `apps/mobile/src/lib/grant-signing.ts` | Reuses `canonicalGrantBytes` from `@vsbs/shared/commandgrant-lifecycle` so the device hashes the same RFC 8785 byte stream the API will witness-co-sign. SHA-256 challenge → passkey assertion → server round-trip → authority-chain verification (`verifyAuthorityChain`). Fails closed on chain mismatch. |
| Push notifications | `apps/mobile/src/lib/notifications.ts` | `expo-notifications` register + 5 notification kinds (booking-state-changed, autonomy-grant-issued, autonomy-grant-expiring T-5min, payment-required, service-complete). Each notification verified with HMAC-SHA-256 over a canonical payload using a server-issued key in expo-secure-store; failed verification is dropped. PII never appears in the body. |
| BLE OBD-II | `apps/mobile/src/lib/ble-obd.ts` | ELM327 / vLinker MS driver via `react-native-ble-plx` with the SAE J1979 wake sequence (AT Z, AT E0, AT L0, AT S0, AT SP 0). Decoders for 8 PIDs (RPM, speed, coolant, load, throttle, fuel level, baro, intake-temp) following SAE J1979 §6.5 verbatim. Sim source emits synthetic samples on a 1 Hz cadence. Every sample stamped `origin: real \| sim` so simulation can never enter real decision logs. |
| Camera + audio | `apps/mobile/src/lib/{camera,audio}.ts` | `expo-camera` capture with EXIF strip + multipart upload to `/v1/intake/photo`. `expo-av` recording for engine / brake noise + upload to `/v1/intake/audio`. PII rule: only booking id and a fixed `kind` enum tag travel with the upload. |
| i18n | `apps/mobile/src/i18n/{messages,provider,index}.ts` | en + hi catalogues mirroring `apps/web/messages/`. 8 more LocaleSchema values aliased. Locale persisted in AsyncStorage; system locale used as default. |
| Theme | `apps/mobile/src/theme/{tokens,provider}.ts` | OKLCH palette ported to RN sRGB hex. Light + dark + high-contrast modes. 44pt min touch target enforced via `minTouchTarget` constant. |
| UI primitives | `apps/mobile/src/components/{Button,Card,TextField,Banner,Screen}.tsx` | accessibilityRole / accessibilityState on every interactive surface. `react-native-toast-message` for transient feedback. SafeAreaView for notch + nav-bar inset. |
| Region detection | `apps/mobile/src/lib/region.ts` | Locale region code → asia-south1 / us-central1, with user-pin override in AsyncStorage. Uses Expo Constants `extra.{apiBaseIN,apiBaseUS,demoApiBase}` so the same binary points at any region. |
| Offline outbox | `apps/mobile/src/lib/offline.ts` | AsyncStorage queue with monotonic ids + exponential backoff. Drops poison entries after 50 attempts. Senders are kind-keyed; unrecognised entries stay in the queue rather than disappearing. |
| PII-free analytics | `apps/mobile/src/lib/analytics.ts` | Fixed-shape event-props (no free-form strings). Local AsyncStorage queue capped at 1000 events. Flushed only when the user has granted `ml-improvement-anonymised`. |
| Tests | `apps/mobile/__tests__/*.test.ts` | **46 unit tests passing** across api (6 — Zod schemas), ble-obd (7 — SAE J1979 decoder), grant-signing (4 — chain verification with real `appendAuthority`), sse (4), theme (4), i18n (5), region (3), offline (4), notifications (5 — including a real HMAC round-trip), analytics (3). Jest + ts-jest preset on Node; RN modules mocked at the file level so we don't pull in the Flow-typed RN polyfills. |
| Docs | `docs/mobile.md` | Architecture overview, run / test instructions, store-submission checklist (Apple Team / ASC ids, deep-link verification, accessibility audits, privacy nutrition labels). |


## Phase 10 complete (2026-04-28) - Admin console

| Capability | File(s) | Status |
|---|---|---|
| Admin Next.js app (`@vsbs/admin`) | `apps/admin/` | New Next.js 16 + React 19 + Tailwind 4 + next-intl 4 workspace. Dev port 3001. Strict CSP (nonce per request) and `X-Robots-Tag: noindex,nofollow`. en + hi locales. `/[locale]` static-rendered for all operator pages, dynamic `/[locale]/audit/[grantId]` and `/api/proxy/[...path]`. |
| IAP gating | `apps/admin/src/proxy.ts` + `apps/admin/src/app/api/dev-login/route.tsx` | Two-layer non-bypassable gate. Live: requires `x-goog-iap-jwt-assertion` with `roles: ["admin"]`. Sim: signed dev token cookie issued by `/api/dev-login`, refused when `APP_ENV=production`. Public allow-list is small and explicit. |
| Operator console pages | `apps/admin/src/app/[locale]/(operator)/{bookings,capacity,routing,slots,fairness,safety-overrides,pricing,sla,audit}/` | 9 operator pages plus `audit/[grantId]` detail and `audit/merkle` Merkle root index + verifier. Bookings page subscribes to live SSE updates. Capacity page is a 7-day x 24-hour ARIA-labelled heat map. Pricing page enforces draft → review → published transitions with diff view. Audit detail does WebCrypto-backed canonical-bytes recompute and Merkle inclusion verification client-side. |
| Operator nav + UI primitives | `apps/admin/src/components/{OperatorNav,ui/{Card,Button,DataTable,StatusPill}}.tsx` | shadcn-grade primitives. `DataTable<Row>` is sortable per column, supports row selection with bulk-action callback, ARIA `aria-sort` and per-row `aria-label`. Co-owned with the observability peer; obs nav items are merged into `OperatorNav`. |
| Admin API surface | `apps/api/src/routes/admin/router.ts` + `apps/api/src/routes/admin/store.ts` | `buildAdminRouter` mounts at `/v1/admin` with `adminOnly` middleware. Endpoints: `/bookings` (cursor pagination + filters), `/bookings/stream` (SSE), `/bookings/:id/{reassign,cancel,escalate}`, `/capacity/heatmap`, `/routing` + `/routing/{rerun,override}`, `/slots` + `/slots/:id`, `/fairness/metrics`, `/safety-overrides`, `/pricing/:scId` + `/pricing/{draft,transition}`, `/sla`, `/audit/grants`, `/audit/grants/:grantId`, `/audit/merkle/roots`. All Zod-validated. Deterministic seeded data set so the operator console renders end-to-end with no external dependency. |
| Admin gate middleware | `apps/api/src/middleware/admin.ts` | `adminOnly({ mode, appEnv })`. IAP path: 401 on malformed/expired, 403 on missing admin role. Sim path: same, gated on `appEnv !== "production"`. Vary header set so caches never serve admin to anonymous. |
| Operator handbook | `docs/operator-handbook.md` | Page-by-page guide (purpose, signals to watch, escalation), daily and weekly review checklists, escalation matrix, manual audit-log verification recipe. |
| Tests | `apps/admin/__tests__/{audit-crypto,Button,StatusPill,DataTable}.test.{ts,tsx}` + `apps/api/src/routes/admin/admin.test.ts` | **17 admin app tests** (audit-crypto 6, Button 4, DataTable 4, StatusPill 3) and **16 admin API tests** (gate 4, list/cursor 2, region filter 1, capacity 1, routing rerun 1, slot CRUD 1, reassign 1, safety filter 1, pricing transitions 1, audit detail + merkle 2, expired token 1). All green. |


## Phase 5 complete (2026-04-28) — Consent + compliance

| Capability | File | Status |
|---|---|---|
| Consent manager (DPDP Rules 2025 + GDPR Art. 7) | `packages/compliance/src/consent.ts` | `ConsentManager` interface + `InMemoryConsentManager` append-only ledger. UUIDv7 row ids (RFC 9562), SHA-256 evidence hash over canonical JSON of the notice shown, version-aware re-consent detection, default purpose registry covering all seven `ConsentPurpose` values with English + Hindi descriptions and per-purpose lawful basis. |
| Right to erasure (DPDP s.12, GDPR Art. 17, CCPA s.1798.105) | `packages/compliance/src/erasure.ts` | `ErasureCoordinator` interface + `StandardErasureCoordinator` cascading across Firestore, Cloud Storage, BigQuery, backups, caches, PSP, and analytics shaped sim stores. Idempotent on `Idempotency-Key`, append-only receipt log with per-system row counts, `verifyErased` round-trip. |
| 72-hour breach reporter (DPDP Rule 7, GDPR Art. 33) | `packages/compliance/src/breach.ts` | `StandardBreachReporter` with SLA clock seeded from detection time, structured timeline (detected -> ic-engaged -> contained -> ... -> closed), DPB / supervisory / data-principal notification queues, `hoursRemaining` and `isOverdue` for the on-call dashboard. |
| DPIA + FRIA generator | `packages/compliance/src/dpia.ts` | Subset-YAML frontmatter parser (Zod-validated), pluggable `AssessmentSource` (filesystem or in-memory) so the package stays Node/browser portable. Surfaces structured risks and `signoff_required` lists from `docs/compliance/dpia.md` and `docs/compliance/fria.md`. |
| AI risk register | `packages/compliance/src/ai-risk-register.ts` | 22 hard-coded rows (R01-R22) mapped to NIST AI RMF 1.0 categories (govern / map / measure / manage) and OWASP GenAI Top 10 (2025). Filter helpers, integrity report, all rows reference at least one control. |
| Per-jurisdiction policy resolver | `packages/compliance/src/jurisdiction.ts` | `IN`, `EU`, `UK`, `US-CA`, `US-other`, `other` buckets. Real DPDP / GDPR / AI Act / UK GDPR / CCPA + CPRA values for lawful bases, required notices, erasure right, portability, Art. 22, data localisation, DPO requirement, breach window, age of consent, sale opt-out. ISO 3166-1 country-code mapper. |
| API surface | `apps/api/src/routes/me.ts` | `GET /v1/me/consent`, `POST /v1/me/consent/grant`, `POST /v1/me/consent/revoke`, `DELETE /v1/me/consent/:purpose`, `POST /v1/me/erasure` (idempotent), `GET /v1/me/erasure/:tombstoneId`, `GET /v1/me/erasure`, `GET /v1/me/data-export`. All Zod-validated; legacy DELETE route preserved for the v0 web client. |
| Consent gate middleware | `apps/api/src/middleware/consent-gate.ts` | `requireConsent(purpose)` factory; mounted on `/v1/intake/*`, `/v1/dispatch/*`, `/v1/payments/*`, `/v1/autonomy/grant`, `/v1/sensors/ingest`. Returns `409 {error: {code: 'consent-required' or 'consent-stale', purpose, currentVersion, noticeUrl}}`. |
| Web consent UI | `apps/web/src/app/me/consent/ConsentToggles.tsx` | Per-purpose toggles, version-diff banner when re-consent required, label-input pairs, focus-visible, AAA contrast. en + hi i18n with `staleBanner`, `staleDetail`, `versionDetail`, `grant` keys added. |
| Tests | `packages/compliance/tests/` + `apps/api/src/routes/me.test.ts` + `apps/api/src/middleware/consent-gate.test.ts` | 34 compliance unit tests + 6 me-route tests + 4 consent-gate tests = 44 new tests. Coverage: consent grant/revoke/re-grant, evidence-hash determinism, erasure cascade + idempotency + verify, breach SLA clock + overdue + notify chain, DPIA frontmatter parse + reject malformed, AI risk register integrity, jurisdiction matrix coverage. |
| Compliance docs | `docs/compliance/jurisdictions.md`, `docs/compliance/ccpa-cpra.md`, `docs/compliance/eu-ai-act.md`, `docs/compliance/breach-runbook.md` (extended) | Per-jurisdiction matrix with side-by-side rights/notices/retention, CCPA + CPRA Notice at Collection (full template), EU AI Act Art. 27 FRIA + Annex VI conformity mapping, breach runbook section 10 (BreachReporter integration) + section 11 (cross-references). |

## Phase 8 complete (2026-04-28) — Realtime + UX polish

| Capability | File(s) | Status |
|---|---|---|
| shadcn-grade UI primitives | `apps/web/src/components/ui/{Button,Card,Dialog,Tabs,Toast,Skeleton,Spinner,Tooltip,Drawer,Combobox,Form}.tsx` + `focusTrap.ts` + `cn.ts` + `index.ts` | 24 primitives implemented from scratch with Radix-grade focus management, ARIA, keyboard nav, ESC/Tab/Shift-Tab/Arrow keys; reduced-motion honoured. `Form.tsx` bundles Input, Textarea, Select, Toggle, Switch, Checkbox, RadioGroup, Slider, Badge, Avatar, Alert, Progress, Label. Tooltip uses 700 ms delay. No external Radix dependency taken; the API mirrors shadcn exactly. |
| State surfaces | `apps/web/src/components/states/{index.tsx,illustrations.tsx}` | Reusable `EmptyState`, `LoadingState`, `ErrorState`, `SuccessState` with inline decorative SVGs, role=status / role=alert wiring, aria-labelledby on the heading id, optional primary action (button or link). |
| Motion utilities | `apps/web/src/lib/motion.ts` | `useReducedMotion()` React hook, `motionEase('out-quint')` named bezier registry, `MOTION_DURATIONS` of 150/200/300 ms. CSS already short-circuits transitions globally; JS-driven canvas animations also consult the hook. |
| Voice intake | `apps/web/src/lib/voice.ts` + `apps/web/src/app/book/voice/{page,VoiceIntakeClient}.tsx` | `useVoiceIntake({onPartial,onFinal,onError})` with `start/stop/cancelTts`. WebSocket transport with AudioWorklet PCM capture (live), deterministic in-browser scripted utterance generator (sim), `speechSynthesis` TTS reply with full barge-in cancellation. Push-to-talk page renders a canvas waveform driven by RMS, partial-transcript live region, and an editable final transcript. |
| Photo intake | `apps/web/src/lib/photo.ts` + `apps/web/src/app/book/photo/{page,PhotoIntakeClient}.tsx` | getUserMedia capture, EXIF strip via canvas re-encode, quality-stepped JPEG compression under 900 KiB, file fallback. Multipart upload to `/v1/intake/photo` with intakeId + kind. Server returns deterministic finding fixtures (dashcam, instrument-cluster, exterior, underbody). |
| Audio / noise intake | `apps/web/src/lib/audio.ts` + `apps/web/src/app/book/noise/{page,NoiseIntakeClient}.tsx` | Web Audio FFT + 64-bin mel filterbank (16 frames), WAV encoder, multipart upload to `/v1/intake/audio`. Server fixtures: brake-squeal, valve-tap, cv-joint-clunk. Live RMS meter + role=meter widget. |
| Offline persistence + queue | `apps/web/src/lib/offline.ts` + `apps/web/public/sw.js` | Hand-rolled IndexedDB store (drafts, queue, meta) with last-write-wins draft sync. `fetchOrEnqueue()`, `flushQueue()`, `useOnline()`. Service worker strategies: NetworkFirst for /api/proxy/*, StaleWhileRevalidate for /_next/static/* + /icons/*, CacheFirst for /fonts/*, navigation NetworkFirst with `/offline` fallback. Background sync replays the same IDB queue on `sync` events. |
| Web Vitals reporter | `apps/web/src/lib/lighthouse.ts` | Hand-rolled PerformanceObserver-based LCP / INP / CLS / FCP / TTFB sampler, sendBeacon / keepalive POST to `/api/proxy/metrics/web-vitals`. 100% sample in dev, 10% in prod. `installVitalsReporter({echo})`. |
| App-boot client component | `apps/web/src/components/AppBoot.tsx` | Mounted once in the root layout. Registers the service worker, installs the Web Vitals reporter, listens for online / offline transitions, flushes the offline queue on reconnect, and announces the transition through a sr-only live region. |
| Autonomy dashboard | `apps/web/src/app/autonomy/[id]/{page,AutonomyDashboard}.tsx` + `apps/web/src/components/autonomy/{CameraTile,SensorTile,PhmTile,CommandGrantCard,OverrideButton,useTelemetryStream}.tsx` | Multi-camera 4-quadrant tile (canvas painter, reduced-motion safe), six sensor tiles (speed, heading, brake-pad %, HV SoC, coolant temp, TPMS), six PHM tiles (engine, brake, electrical, hv-battery, tyres, sensors-health), command-grant card with RFC 8785 canonical-bytes preview, ML-DSA signature hash, three-step witness chain. Override button is a large danger-coloured Dialog confirmation that calls `/v1/autonomy/grants/:id/revoke`. WebSocket primary, SSE fallback, deterministic local-sim feed if neither is available. |
| Help centre | `apps/web/src/app/help/{page,HelpSearch}.tsx` + `apps/web/src/app/help/[slug]/page.tsx` + `apps/web/src/content/help/index.ts` + `apps/web/src/lib/helpSearch.ts` | Ten plain-language articles indexed inline (getting-started, booking-a-service, voice-intake, photo-upload, autonomy-handoff, command-grants, payments, refunds, deletion-and-erasure, contact-support). TF-IDF inverted index, 700 ms debounced live search, `generateStaticParams` so every slug pre-renders. Renders a minimal CommonMark subset (H1/H2, ordered/unordered lists, bold, inline code). |
| Offline page | `apps/web/src/app/offline/page.tsx` | Service worker navigation fallback. Lists what still works (cached, queued, safety-critical). Linked to home. |
| Home page audit | `apps/web/src/app/page.tsx` | Quick-links grid added (book, voice, photo, noise, help, consent). All links typed via `typedRoutes` in next.config.ts. AAA contrast preserved. |
| API routes | `apps/api/src/routes/intake.ts` (new) + `apps/api/src/routes/metrics.ts` (extended) | `POST /v1/intake/photo` and `POST /v1/intake/audio`: 5 MiB multipart cap, full Zod validation, fixture responses. `POST /v1/metrics/web-vitals`: validates the schema and emits a structured `web_vital` log with the request id. Path-aware body cap raised in `server.ts` for the upload routes only. |
| i18n | `apps/web/messages/en.json`, `apps/web/messages/hi.json` | Extended with `home.quickLinks.*`, `voice.*`, `photo.*`, `noise.*`, `help.*`, `offline.*`, `autonomy.live.*`, `autonomy.toast.*`. Both languages updated symmetrically. |
| Lighthouse CI | `.lighthouserc.json` | Budgets: Performance >= 0.9, Accessibility = 1.0, Best-Practices >= 0.95, SEO >= 0.95, LCP <= 2500 ms, INP <= 200 ms, CLS <= 0.1, TBT <= 200 ms. Three runs per URL, 4 URLs (`/`, `/book`, `/help`, `/me/consent`). |
| Tests | `apps/web/test/{Button,Dialog,Tabs,Toast,Form,Combobox,states,SensorTile,PhmTile,CommandGrantCard,AutonomyDashboard.snapshot,helpSearch,cn,motion,Tooltip,Skeleton,Drawer,CameraTile}.test.{ts,tsx}` | **53 web component tests** (Button 5, Dialog 3, Tabs 2, Toast 3, Form 11, Combobox 2, states 4, SensorTile 2, PhmTile 2, CommandGrantCard 2, AutonomyDashboard snapshot 1, helpSearch 4, cn 4, motion 2, Tooltip 1, Skeleton 2, Drawer 1, CameraTile 2). All passing under jsdom + @testing-library/react + @vitejs/plugin-react. |


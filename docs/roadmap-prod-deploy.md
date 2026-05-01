# Roadmap — Everything Required for Fully-Autonomous Production Deployment (India + US)

> This is the complete build list from research-preview to production-ready, covering India (asia-south1) and US (us-central1). Ordered so that dependencies land before dependants.

## 0. Already shipped

See [docs/gap-audit.md](gap-audit.md) for the complete "what is real today" inventory. TL;DR: research foundation, core contracts, safety + wellbeing + autonomy + PHM logic, sensor fusion + simulator + RUL stubs, real NHTSA + Routes adapters, Next.js 16 scaffold, Terraform baseline, CI.

## Phase 1 — Core autonomous booking loop (demo mode)

Goal: anyone can open the web app, book a service end to end autonomously, with simulated external dependencies that implement exact production logic per [simulation-policy.md](simulation-policy.md).

1. **Demo-mode OTP auth** — live-display OTP to the UI instead of SMS. Same code paths as the live driver. `AUTH_MODE=sim`. Includes rate limit + lockout + replay protection.
2. **Agent orchestrator** (`packages/agents`) — LangGraph hierarchical supervisor + Claude Opus 4.6 + Claude Haiku 4.5 verifier chain + Mem0 memory + Gemini 2.5/3 Pro for grounded search and voice. Tool registry wired to the existing API.
3. **Intake conversation** — conversational six-step intake with voice fallback (Gemini Live API demo driver), photo + audio upload, full schema coverage from [packages/shared/src/schema/intake.ts](../packages/shared/src/schema/intake.ts).
4. **Diagnosis specialist** — retrieves from the generic DTC corpus (Wal33D/dtc-database) + NHTSA TSBs + NHTSA Recalls; grounded responses with citations; differential ranked by severity and probability.
5. **Dispatch specialist** — GMPRO for multi-mechanic VRP, Routes API v2 for ETA, wellbeing scorer for ranking, safety pre-filter. Three-mode dispatch (drive-in / mobile / pickup-drop / tow) with the India GoMechanic-inspired default preference for pickup-drop.
6. **Concierge supervisor** — owns the conversation, explainable recommendation drawer, override on every step.
7. **Booking commit path** — Firestore write + idempotency key + Pub/Sub event + audit log.
8. **Status dashboard** — SSE ticker to `/status/[id]`, optimistic updates.
9. **Payments, simulated end-to-end** — Razorpay sandbox driver + UPI sandbox driver + Stripe test driver, all behind the shared payment state machine from [simulation-policy.md](simulation-policy.md).
10. **Demo banners** — persistent AAA-contrast banner on every page that is in sim mode.

## Phase 2 — Sensor + PHM + autonomy foundations

11. **Sensor ingest** — Smartcar adapter (live for US vehicles) + OBD-II dongle gateway (BLE ELM327 / vLinker MS) for everywhere Smartcar does not cover, especially India BS6 Phase 2 vehicles.
12. **EKF / UKF for multi-state channels** — upgrade from scalar Kalman for position, heading, SoC, cell-imbalance trend.
13. **PHM RUL models beyond brake pads + 12 V battery** — tyres (NHTSA + tread wear), HV battery SoH (Severson 2019 capacity-fade benchmark), engine oil (age + odometer since last change), drive belt, wheel bearings (vibration spectrum).
14. **Fault vs sensor-failure arbitration in production** — already in code, now fed real samples end to end.
15. **Takeover ladder + minimum-risk maneuver** — multi-modal alert pipeline (tactile, auditory, visual, haptic), UNECE R157-aligned.
16. **Command-grant lifecycle** — passkey signing on device, server witness signing, append-only authority chain, revocation ping.
17. **Autonomy-tier capability resolver in production** — per-OEM capability registry, geofence catalogue, insurance-eligibility integration.
18. **AVP integration** — adapter for Mercedes/Bosch Intelligent Park Pilot (Tier A at Stuttgart P6 and any future approved garage).

## Phase 3 — Knowledge base + retrieval

19. **AlloyDB for PostgreSQL + pgvector 0.7** provisioned for the repair knowledge graph.
20. **Vertex AI Vector Search** for hybrid dense + sparse retrieval at scale.
21. **GraphRAG ingestor** — entity-centric chunking of TSBs, recalls, manuals with cost-optimised token strategy.
22. **DTC corpus bundling** — Wal33D/dtc-database as a shipped resource pack with provenance manifest.
23. **ISO 2575 tell-tale registry** — symbol id, colour, severity metadata.
24. **Indic NLP pipeline** — AI4Bharat IndicTrans2 + IndicBERT v2 + Bhashini fallback for hi/mr/ta/te/bn/gu/kn/ml/pa/or/as symptom capture.
25. **Multilingual embedding index** — BGE-M3 for the KG.
26. **OEM manual plug-in interface** — operator attaches their Mitchell1 / ALLDATA / HaynesPro feed under their own EULA; tenant-scoped retrieval.

## Phase 4 — Dual-region deployment (India + US)

27. **Dual-region Terraform** — asia-south1 (India) and us-central1 or us-east1 (US) with independent data planes for DPDP-India-residency.
28. **Region router** — requests pinned to region by user jurisdiction; cross-region only for aggregate analytics.
29. **Global auth** — Identity Platform with tenant per region; federated sessions with region-stickiness.
30. **Firestore multi-region replication** — within-region failover for each data plane.
31. **BigQuery regional datasets** — India and US analytics never cross without explicit purpose.
32. **Cloud DNS + Cloud Load Balancing + Cloud Armor** — region-aware ingress, WAF rules per region.
33. **Cloud CDN** — edge cache for web shell + static assets.
34. **Cross-region observability** — Cloud Logging / Monitoring / Trace aggregated for operators but tagged per region for residency.

## Phase 5 — Consent + compliance

35. **DPDP Rules 2025 consent manager integration** — per-purpose, versioned, evidence-hashed consent log. Revocation flow. Notice diff + re-consent.
36. **Data Fiduciary contact + DPO contact** — published in the product.
37. **Right to erasure** — `DELETE /me` cascades to Firestore + Cloud Storage + BigQuery + backups + caches.
38. **Breach notification runbook** — 72 h Data Protection Board template + pager.
39. **GDPR parity for US + EU customers** — Art 22 explainability log, DPIA + FRIA documents.
40. **EU AI Act high-risk conformity** — autonomous handoff and auto-pay are high-risk; FRIA (Art. 27), risk management (Art. 9), technical documentation (Art. 11), transparency (Art. 13), human oversight (Art. 14), accuracy + robustness (Art. 15).
41. **US privacy** — CCPA + CPRA for California; state-specific consent handling.
42. **AI risk register** — NIST AI RMF 1.0 mapping + OWASP GenAI Top 10 2025 controls.

## Phase 6 — Security hardening

43. **Post-quantum hybrid TLS** — `X25519MLKEM768` preferred at GFE.
44. **Cloud KMS PQ envelope** — ML-KEM-768 + ML-DSA-65 hybrid, GA on GCP, for PII + refresh tokens + signing keys.
45. **WebAuthn + passkeys** for both owner app and command-grant signing.
46. **Zero trust** — BeyondCorp + IAP for admin; VPC-SC for data exfil; Workload Identity Federation for CI.
47. **Binary Authorization** with Sigstore attestations; Artifact Registry; Trivy + OSV-Scanner in CI.
48. **Cloud Armor** — OWASP CRS 4.x, reCAPTCHA Enterprise on auth + auto-pay authorisation.
49. **SRI + strict nonce-based CSP** — shipped in middleware; enforced in tests.
50. **Rate limiting + anti-abuse** — per-user and per-IP at Cloud Armor; Valkey-backed sliding window at app layer.
51. **Secret rotation** — 30-day automated via Secret Manager + KMS.
52. **PII-redaction middleware** — between app and any LLM prompt or log.

## Phase 7 — Observability + operations

53. **OpenTelemetry JS SDK** — traces across web, API, agents, adapters; exported to Cloud Trace.
54. **Structured JSON logging** — every line stamped with trace id, span id, user (hashed), tenant, region, subsystem.
55. **Metrics** — p50/p95/p99 latency, error rate, throughput per endpoint; wellbeing-score distribution; dispatch-mode mix; safety-override counts.
56. **SIEM dashboard** — real-time feed, filterable, searchable, IAP-gated.
57. **Alerting on symptoms not causes** — per-service SLOs with burn-rate alerts; synthetic monitoring for the booking happy path and the autonomy-handoff happy path.
58. **/health with dependency status on every service.**
59. **Canary releases + kill-switch feature flags** — per-agent and per-adapter.
60. **Runbooks** — for each alert; published to ops.

## Phase 8 — Realtime + UX polish

61. **Autonomy dashboard** — multi-camera live tile + sensor tiles + PHM tiles + command-grant status + override button; WebSocket primary (Ably if escalated); accessible alternatives for all motion. **2026-05-01: extended to a full L5 sensor stream** — per-booking pub/sub hub (`apps/api/src/adapters/autonomy/live-hub.ts`) accepting 10 Hz frames + perception events from the CARLA bridge or a GPU-free chaos driver, fanned out to the dashboard via `/v1/autonomy/:id/{telemetry,events}/sse`; dashboard renders 12 sections (cameras × 8, 4D imaging radar × 4, LiDAR, thermal, audio, multi-constellation GNSS+RTK, IMU, dynamics, motors + 96-cell HV pack heat-map, AI compute + lockstep + HSM, network, V2X bus, ODD + Mahalanobis OOD + R157 ladder + MRM, DMS + cabin air, environment, software footer) plus a live perception event log. Wire-identical CARLA bridge or chaos scenario can drive it.
62. **Voice intake production** — Gemini Live API on a streaming route with barge-in and partial transcripts.
63. **Photo pipeline** — dashcam + instrument cluster photo → Gemini 2.5/3 Pro multimodal → structured findings.
64. **Engine/brake noise pipeline** — mel-spectrogram + labelled reference library.
65. **Offline-first UX** — Serwist SW + Dexie + Yjs + background sync.
66. **shadcn + Radix polish** — component library, accessibility audit, Lighthouse CI gates.
67. **Motion system** — 150–300 ms ease-out entries, reduced-motion alternate paths.
68. **Empty, loading, error, and success states for every page.**
69. **Help centre with search**; consistent-help criterion.

## Phase 9 — Mobile

70. **React Native (Expo) owner app** — shared contracts with web (`@vsbs/shared`), passkey registration, camera + mic + Bluetooth OBD dongle ingestion.
71. **Native passkey signing of command grants.**
72. **Push notifications** — Firebase Cloud Messaging for booking + autonomy events.

## Phase 10 — Admin console

73. **Operator dashboard** — bookings queue, capacity heat map, technician routing, slot editor, fairness monitor, safety overrides log.
74. **Pricing editor** — parts + labour catalogue per SC.
75. **SLA manager** — per-service-centre.
76. **Audit viewer** — command-grant chains, authority-log Merkle proofs.

## Phase 11 — Quality + verification

77. **Unit tests** — shared, sensors, API (Vitest).
78. **Property-based tests** — fast-check on schema validators and wellbeing scorer.
79. **Playwright e2e** — happy path + edge cases + WCAG axe assertions on every page.
80. **Load tests** — k6 or Artillery on the API.
81. **Chaos tests** — dependency failure injection; verify graceful degradation.
82. **Safety regression suite** — every historical red-flag case as a test.
83. **Agent eval harness** — BFCL-style function-call accuracy on our own tool set; τ2-bench-style scenario eval.
84. **Prompt-injection red team** — fixed corpus of jailbreak attempts in CI.

## Phase 12 — Pilot + go-live gates

85. **Closed pilot** — ≤ 100 bookings with human supervisor observation.
86. **External security audit** (OWASP ASVS L2 minimum, L3 preferred).
87. **External accessibility audit.**
88. **DPIA + FRIA signed** by appointed privacy officer and DPO.
89. **Insurance alignment** for the autonomy path.
90. **Bug-bounty programme live.**
91. **Incident response plan rehearsed.**
92. **Regulatory pre-notification** as applicable per region.
93. **Flip `AUTONOMY_ENABLED=true`** only after everything above is green.

## OEM-specific adapter work

These are the actual adapters that would be written for specific OEM partnerships, each behind the existing capability + command-grant + sensor interfaces.

- **Tesla** — no open vehicle API; adapter would plug into any future third-party access if Tesla opens one. Until then, Tesla owners use the generic OBD-II dongle / Smartcar path.
- **Mercedes-Benz** — AVP adapter for Intelligent Park Pilot + DRIVE PILOT L3 adapter for conditional highway legs.
- **BMW** — AVP + Remote Park.
- **Hyundai / Kia** — BlueLink + RSPA.
- **Tata / Mahindra / Maruti** — India OEM telematics (iRA, AdrenoX, Maruti-MapMyIndia) — no unified API; per-OEM adapters.
- **Waymo / Zoox** — operator-fleet API for fleet partners.

Every adapter implements the same five capabilities: `authenticate()`, `readState()`, `acceptGrant()`, `performScope()`, `revokeGrant()`. A new OEM is one file plus tests.

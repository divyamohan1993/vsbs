# Stack

Every choice below is the most advanced production-ready option for its layer. Each is traceable to a cited research doc in `docs/research/*`.

## Runtime & language

| Layer | Choice | Why |
|---|---|---|
| API runtime | **Bun 1.2** on Cloud Run | native TS, fastest HTTP in the Node ecosystem, built-in test + bundler. Hono runs on Bun without adapters. |
| Web runtime | **Node 22 LTS** on Cloud Run (Next.js 16 requires Node ≥ 20) | Next.js 16 not yet officially on Bun. |
| Language | **TypeScript 5.7** strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | — |

## Agents

The LLM layer is **provider-agnostic**, implemented in [`packages/llm`](packages/llm/). Every agent role resolves a (provider, model) pair at startup via a `LlmRegistry`. Promotion from demo to prod is `LLM_PROFILE=prod`, nothing else.

| Layer | Choice |
|---|---|
| Outer orchestrator | **LangGraph** — production-mature April 2026 (Uber, Klarna, LinkedIn, JPMorgan, 400+); hierarchical supervisor + Postgres checkpoints + crash recovery |
| LLM interface | `Llm.complete()` over a normalised request/response (`packages/llm/src/types.ts`) |
| Providers shipped | **Google AI Studio**, **Vertex Gemini**, **Vertex Claude**, **Anthropic direct**, **OpenAI** — all real, all implement the same interface |
| Demo profile (cheapest) | Google AI Studio `gemini-2.5-flash-lite` for every role, `gemini-2.5-flash` for diagnosis + autonomy. Free-tier friendly. |
| Prod profile (best April 2026) | `claude-opus-4-6` on Vertex for concierge / diagnosis / autonomy, `gemini-3-pro` on Vertex for dispatch + wellbeing / intake, `claude-haiku-4-5-20251001` on Vertex for verifier + payment |
| Memory pattern | Mem0 (`arXiv:2504.19413`, ECAI 2025) |
| Routing | Unified routing + speculative cascades (arXiv 2410.10347 + Google Research speculative cascades) |

The Claude Agent SDK, Managed Agents beta, and CLI-auth path are **optional escape hatches**, not the default. The default path authenticates every model through GCP Workload Identity inside `dmjone`, which means: zero Anthropic API key required, one billing relationship, one IAM model.

## Web

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** App Router + **React 19** + **React Compiler stable** |
| Rendering | RSC + Streaming + Cache Components (PPR productionised in Next.js 16) |
| Styling | **Tailwind CSS 4** (engine rewritten in Rust, OKLCH tokens) |
| Components | **shadcn/ui** + **Radix** primitives |
| i18n | **next-intl 4** |
| Offline | **Serwist** service worker + **Dexie 4** (blob + catalogue caches) + **Yjs + y-indexeddb** CRDT (booking draft, structured state) |
| Realtime | **SSE on Hono/Cloud Run** primary; **Ably** as escalation for presence / history / rewind / bidirectional (autonomy dashboard) |
| Forms | **React Hook Form 7** + **Zod 3** resolvers |
| Motion | **Motion 11** respecting `prefers-reduced-motion` |

## Data & retrieval

| Layer | Choice |
|---|---|
| Booking DB | **Firestore** (Native mode, asia-south1, multi-region failover) |
| Analytical | **BigQuery** |
| Relational + KG + vector | **AlloyDB for PostgreSQL** + **pgvector 0.7** + **Drizzle 0.35** ORM |
| Vector ANN | **Vertex AI Vector Search** (ScaNN-backed) |
| Retrieval pattern | Hybrid BM25 + **ColBERTv2 late-interaction**; **GraphRAG** entity-centric chunks |
| PDF ingest | **Document AI** |
| Events | **Pub/Sub** |
| Cache | **Memorystore for Valkey** |

## Sensors & PHM

| Layer | Choice |
|---|---|
| Sensor sim | custom `packages/sensors` with noise models + fault injection |
| Fusion | Extended & Unscented Kalman filters (`packages/sensors/fusion.ts`) |
| RUL models | physics-of-failure for well-understood components + ensemble transformer baseline for complex (benchmarked on C-MAPSS, NASA PCoE) |
| Standards | ISO 13374 (PHM pipeline), ISO 21448 (SOTIF), ISO 26262 (functional safety) |

## Security

| Layer | Choice |
|---|---|
| Transport | TLS 1.3 hybrid ECDHE+ML-KEM-768 (`draft-ietf-tls-ecdhe-mlkem`) at GFE |
| Envelope | AES-256-GCM DEK wrapped by Cloud KMS hybrid KEK |
| Auth | Identity Platform + passkeys + WebAuthn Level 3 |
| Edge | Cloud Armor + OWASP CRS 4.x + reCAPTCHA Enterprise |
| Zero trust | BeyondCorp + IAP + VPC-SC + Binary Authorization + Workload Identity Federation |
| Secrets | Secret Manager + KMS rotate 30 d |
| Supply chain | SBOM, Trivy, OSV-Scanner, Sigstore-signed images |
| App-layer signing | ML-DSA-65 (FIPS 204) via Cloud KMS when GA; Ed25519 interim |

## Tooling

| Layer | Choice |
|---|---|
| Package manager | **pnpm 9** workspaces |
| Lint + format | **Biome 1.9** (single tool, Rust, 10–100× faster than ESLint+Prettier) |
| Tests | **Vitest 2** for JS/TS; **Playwright** for e2e + a11y axe-core |
| Type-check | `tsc --noEmit` in CI |
| Build | **tsup** for libs; **Next.js** for web; **Bun build** for API |
| CI | GitHub Actions w/ OIDC → Workload Identity Federation |
| CD | Cloud Build → Artifact Registry → Binary Auth → Cloud Run canary |
| Infra | **Terraform 1.10** + Google provider ≥ 6.10 |
| Observability | OpenTelemetry JS SDK + Cloud Trace + Cloud Monitoring + Managed Prometheus |

## Performance doctrine — O(1) everywhere it matters

The system is designed so that **every user-facing request hits a constant-time path** regardless of catalogue size, history length, or tenant count. No per-request linear scans. No unbounded joins. No "we'll paginate later."

| Hot path | Why it's O(1) | Mechanism |
|---|---|---|
| Auth resolve | key lookup | Identity Platform JWT + Valkey session by sid |
| Intake draft read/write | keyed by `draftId` | Firestore document get/put |
| Service-center candidates for a location | precomputed per geohash | background job writes a small (k ≤ 8) neighbour list to Valkey keyed by geohash-5 |
| Maps distance matrix | cached for 30 days (Google ToS allows) | Valkey by `(origin-geohash, dest-placeId)` |
| Repair KG retrieval | ANN on Vertex Vector Search | fixed-k nearest neighbours, effectively O(1) for our k |
| Dispatch objective | scored over a fixed-size candidate list | never scans the whole tenant |
| Wellbeing score | pure function over the candidate | no I/O |
| Safety red-flag check | hash-set membership | deterministic |
| PHM state for a component | keyed by `(vehicleId, componentId)` | Firestore or Valkey |
| Static + PPR shell | edge cache | Cloud CDN (Google Frontend) |
| Prompts | Anthropic prompt cache | 90 % read discount on hits |
| Tool-use args | compiled JSON Schema validator | one-shot per call |
| SSE subscription | fan-out via Pub/Sub topic keyed by booking id | O(1) per subscriber |

**Precomputation wins:** every background job that can collapse a future request to a key lookup runs nightly or on-event. Cost goes on the background rail, latency stays on the main rail.

**Fastest primitive available for each job:**
- API runtime **Bun 1.2** — Bun's `http.serve` outperforms Node `http` by a wide margin and is now production-grade.
- HTTP framework **Hono 4** — trie-router, near-zero per-route overhead, works identically on Bun, Node, and Cloud Run.
- Validator **Zod 3.23** with precompiled schemas at module import (`.parse` amortised constant).
- ORM **Drizzle 0.35** with precompiled prepared statements — no query builder at request time.
- Cache **Valkey 8** on Memorystore — Redis-compatible, Linux Foundation governance, active development.
- CDN **Cloud CDN** in front of Cloud Run — shell cached at edge, holes filled by SSR.
- Serialisation **devalue** for RSC payloads + **msgpack** for sensor streams.

**Premium feel** is earned by **never** making the user wait on a cold lookup:
1. Static shells stream in under 1 s even on 3G.
2. The intake conversation begins with an *optimistic* first prompt while background prefetch loads the owner's history.
3. Diagnosis streams token-by-token via SSE; the UI shows the model "thinking" transparently (operational transparency, Buell & Norton 2011).
4. Autonomy dashboard updates at 10 Hz over a dedicated WebSocket — never polled.
5. Sub-200 ms INP budget enforced at CI.

## References

See each `docs/research/*.md` doc for the citation trail behind every choice.

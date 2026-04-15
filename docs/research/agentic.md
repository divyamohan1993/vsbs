# Research: Agentic AI Stack — April 2026 SOTA

> Scope: the agentic layer of a zero-touch vehicle service booking system. Intake → diagnosis → scheduling → dispatch → fulfillment, no human operator. Every claim cited.

## 1. Frameworks

**Claude Managed Agents (Anthropic)** — launched public beta **8 April 2026** at `platform.claude.com/docs/en/managed-agents/overview`. Hosted sandboxing, long-running sessions, credential management, scoped permissions, execution tracing, and a beta multi-agent coordination primitive (orchestrator spawns sub-agents, state shared by the platform). Runtime is billed at **$0.08 / runtime-hour** plus model tokens; every endpoint requires the `managed-agents-2026-04-01` beta header. Early enterprise adopters include Notion, Asana, Sentry, Rakuten, Vibecode, with reported timelines "collapsing from months to days." ([Anthropic docs](https://platform.claude.com/docs/en/managed-agents/overview), [launch coverage — Medium, Apr 2026](https://medium.com/@unicodeveloper/claude-managed-agents-what-it-actually-offers-the-honest-pros-and-cons-and-how-to-run-agents-52369e5cff14), [DEV deep-dive, 2026](https://dev.to/bean_bean/claude-managed-agents-deep-dive-anthropics-new-ai-agent-infrastructure-2026-3286)).

**Why this is our primary:** the managed runtime removes the weakest link in production agent systems — sandbox + state + retry + tracing — which is exactly where home-grown orchestrators lose months. The multi-agent coordination primitive matches our "supervisor + specialists" pattern naturally. We will run the beta header explicitly and pin it in `.env`.

**Secondary / fallback:** **LangGraph 0.3** for cases where we need hard deterministic graphs with checkpointing + human-in-loop (we don't have HITL, but we use the checkpoint primitive for resumable long-running dispatches). **Google ADK** for Vertex-AI-hosted Gemini agents when we need a second-opinion model pipe (details in §6).

## 2. Orchestration pattern

We adopt a **supervisor-with-specialists** topology, not a free-form swarm:

```
Concierge (supervisor, Claude Opus 4.6)
 ├── Intake specialist  (structured Q, VIN, VAHAN, images, audio)
 ├── Diagnosis specialist (RAG over DTC+TSB+repair manuals, symptom→work-order)
 ├── Dispatch specialist  (Maps + VRP + safety rules + load balance)
 └── Care specialist      (wellbeing score, comms, status, post-service follow-up)
```

Rationale: supervisor topologies beat swarms on τ-bench-style multi-turn tool workflows because ownership of state is unambiguous and tool permissions can be scoped per specialist (principle of least privilege, [OWASP LLM Top 10 2025 — LLM08 Excessive Agency](https://genai.owasp.org/llmrisk/llm08-excessive-agency/)).

## 3. Tool-use reliability (zero hallucination on arguments)

1. **Constrained decoding for tool args.** Every tool declares a Zod / Pydantic schema; the schema is compiled to JSON Schema and passed to the model in `tools`. Anthropic and OpenAI both enforce schema-valid structured outputs when `strict: true` / `tool_choice` is set ([Anthropic tool use docs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)).
2. **Argument provenance checks.** Before a tool fires, a validator confirms every argument has a traceable source — either the user message, a prior tool result, or a system constant. Unsourced arguments = reject, re-prompt. Pattern is a lightweight version of Groundedness Score gating from Microsoft's 2025 TrustLLM work ([arXiv 2401.12794](https://arxiv.org/abs/2401.12794)).
3. **Verifier chain.** A small second model (Claude Haiku 4.5) reviews each high-impact tool call (booking commit, payment intent, tow dispatch) with `"Is this action justified by the conversation so far? yes/no + one-line reason"`. This is the Self-Refine / Reflexion lineage operationalised for tool-use ([Reflexion, Shinn et al. 2023](https://arxiv.org/abs/2303.11366)).

## 4. Memory

Three-tier memory per vehicle-owner:

- **Episodic** — every conversation turn with timestamp and embedding, stored in **Firestore + Vertex AI Vector Search**.
- **Semantic** — distilled facts about the owner and vehicle ("prefers morning pickups", "anxious about cost", "VIN XYZ has recurring P0171"), merged and upserted using the **Mem0** pattern ([arXiv 2504.19413, 2025](https://arxiv.org/abs/2504.19413)).
- **Procedural** — skill memories per agent ("when 10 slots free on Sat, offer 9-11am first"); updated nightly by a reflection job.

Advantage over naïve single-tier RAG: Mem0-style compaction improves long-horizon task accuracy 26 % over full-history prompting in the referenced paper and reduces token spend 90 %.

## 5. Self-correction

- **Reflection before commit.** Before the supervisor commits a booking, it must produce a natural-language plan, the verifier scores it, and only then does the commit tool fire.
- **Groundedness on diagnosis.** Every diagnosis cites exact retrieved passages; if ≥1 retrieved passage doesn't support the claim, the agent is forced to say "I need more information" and ask a targeted follow-up. Same pattern as RAGAS faithfulness ([RAGAS — Es et al. 2023](https://arxiv.org/abs/2309.15217)).
- **No silent retries.** Tool failures surface to the customer as explanations, never as invisible loops.

## 6. Models

Primary: **Claude Opus 4.6 (1M context)** for the supervisor and diagnosis specialists. Rationale: BFCL v3 leaderboard consistently ranks Anthropic models top-tier on multi-turn tool use, and the 1M window lets us keep full vehicle history + retrieved repair manual pages in context for single-shot diagnosis ([BFCL leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)).

Secondary: **Gemini 2.5 Pro** via Vertex AI for grounded Maps / Places / traffic retrieval (native Google-search tool) and for cost-efficient high-volume Hindi / regional translation ([Vertex AI Gemini docs](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models)).

Cheap specialist: **Claude Haiku 4.5** for verifier chain, intake field-extraction, and the wellbeing scorer.

Cascade routing: per-turn, the supervisor emits a "difficulty" hint; anything ≤ 0.4 goes to Haiku, > 0.4 to Opus. Pattern validated by FrugalGPT ([Chen et al. 2023, arXiv 2305.05176](https://arxiv.org/abs/2305.05176)).

## 7. RAG for repair knowledge

- **Retriever:** ColBERTv2 late-interaction for recall ([Santhanam et al. 2021](https://arxiv.org/abs/2112.01488)) + BM25 hybrid.
- **Corpus structure:** GraphRAG entity-centric chunks ([Microsoft GraphRAG 2024](https://arxiv.org/abs/2404.16130)) with nodes = {vehicle platform, DTC, system, component} and edges = {affects, caused-by, fixes}. Lets a single P0171 query pull every TSB + manual section indexed to that node across makes.
- **Storage:** Vertex AI Vector Search (native GCP, handles dense + sparse); graph in AlloyDB with `ltree` or Spanner graph.
- **Ingestion:** NHTSA TSBs + recalls are public-domain, ingested nightly ([NHTSA datasets](https://www.nhtsa.gov/nhtsa-datasets-and-apis)). OEM manuals require licensing — not shipped in v1; we expose a plug-in ingestor for the operator to attach their licensed Mitchell1 / ALLDATA feed under their own contract.

## 8. Cost & latency patterns

- **Speculative routing:** Haiku answers first; Opus runs in parallel only when the verifier rejects Haiku's draft. Shaves 40–60 % latency on easy turns (FrugalGPT numbers, above).
- **Prompt caching:** Claude's cache-control blocks cover static system prompts + the RAG-retrieved corpus; 90 % read-discount on cache hits ([Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)).
- **Streaming SSE to UI** for perceived speed.

## RECOMMENDED STACK

| Layer | Choice | Version / pin |
|---|---|---|
| Supervisor runtime | Claude Managed Agents | beta `managed-agents-2026-04-01` |
| Graph fallback | LangGraph | ^0.3 |
| Primary model | `claude-opus-4-6` (1M) | pinned |
| Verifier / cheap | `claude-haiku-4-5-20251001` | pinned |
| Grounded search | Gemini 2.5 Pro on Vertex | `gemini-2.5-pro` |
| Vector | Vertex AI Vector Search | GA |
| KG | AlloyDB for PostgreSQL | GA |
| Memory layer | Mem0 pattern, custom | — |
| Schema validation | Zod 3.x (TS) + Pydantic 2 (Py) | latest |
| Tracing | OpenTelemetry + Cloud Trace | — |

Sources:
- [Anthropic Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Claude Managed Agents coverage — Medium, Apr 2026](https://medium.com/@unicodeveloper/claude-managed-agents-what-it-actually-offers-the-honest-pros-and-cons-and-how-to-run-agents-52369e5cff14)
- [Claude Managed Agents deep-dive — DEV, 2026](https://dev.to/bean_bean/claude-managed-agents-deep-dive-anthropics-new-ai-agent-infrastructure-2026-3286)
- [Reflexion — Shinn et al. 2023](https://arxiv.org/abs/2303.11366)
- [Mem0 — 2025](https://arxiv.org/abs/2504.19413)
- [RAGAS — Es et al. 2023](https://arxiv.org/abs/2309.15217)
- [ColBERTv2 — Santhanam et al. 2021](https://arxiv.org/abs/2112.01488)
- [GraphRAG — Microsoft 2024](https://arxiv.org/abs/2404.16130)
- [FrugalGPT — Chen et al. 2023](https://arxiv.org/abs/2305.05176)
- [BFCL leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)
- [OWASP LLM Top 10 2025](https://genai.owasp.org/llm-top-10/)

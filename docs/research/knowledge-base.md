# Research: Knowledge Base + Retrieval

> Goal: ground every concierge answer, every diagnostic suggestion, and every dispatch decision in a **citation-bearing, multilingual, tenant-isolated knowledge base**. No hallucination. No "trust me" answers. Every claim must be traceable to either an SAE / ISO standard, an OEM TSB, an Indic NLP model card, or a peer-reviewed paper.

## 1. Why a dedicated KB layer

A LangGraph supervisor that talks to a customer about brake noise on a 2024 Honda Civic is at risk of two failure modes:

1. **Confabulation.** The LLM invents a TSB number, a torque spec, or a part SKU that does not exist.
2. **Outdated lore.** The LLM recalls a 2021 service procedure when the manufacturer issued a corrected procedure in 2024.

The remedy in production is well established. Retrieval-Augmented Generation (RAG) restricts the model to text that the system itself has put in front of it ([Lewis et al., NeurIPS 2020, "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"](https://arxiv.org/abs/2005.11401)). Microsoft Research's **GraphRAG** extends classical chunk-RAG by indexing the *graph* of entities and their relationships, so the retriever can reason over connections, not just over similarity ([Edge et al., 2024, "From Local to Global: A Graph RAG Approach to Query-Focused Summarization"](https://arxiv.org/abs/2404.16130)).

VSBS combines both: dense + lexical hybrid retrieval at the chunk layer, plus a 2-hop entity neighbourhood expansion at the graph layer.

## 2. Data tier — AlloyDB Omni + pgvector 0.7

**Choice.** Postgres-shaped vector store with HNSW ANN.

**Why.** Because every other layer in VSBS is already in Postgres dialect (Cloud Run + Cloud SQL primary, AlloyDB Omni for the analytics replica). Operating one engine is cheaper and safer than operating two. AlloyDB Omni is 4× faster than vanilla Postgres on vector workloads while remaining wire-compatible (Google Cloud, "AlloyDB Omni now generally available", 2024).

**pgvector 0.7 (April 2024)** brings the **HNSW** index type with concurrent build, halfvec / bit / sparsevec types, and dimension support up to 16 000. We pin the dense column at 768 dimensions (the BGE-M3 dense head) and use HNSW (m=16, ef_construction=64) — the parameter pair Pinecone, Weaviate, and Qdrant all converge on for English+multilingual general-purpose retrieval.

References:
- [pgvector 0.7 release notes](https://github.com/pgvector/pgvector/releases/tag/v0.7.0)
- [Malkov & Yashunin, 2018, "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs"](https://arxiv.org/abs/1603.09320) — the HNSW paper; the parameter trade-offs (recall vs latency vs build cost) we lift directly from §4 of this paper.

The KB layer never trusts that the live driver is wired up: the **`KbClient`** interface is the contract. The default sim driver (`InMemoryKbClient`) implements the same state machine — idempotent upserts, deterministic ordering, the same RRF fusion — so promotion to live is a single-line constructor swap.

## 3. Embedding tier — BGE-M3 (multilingual, 100+ languages)

**Choice.** [BGE-M3](https://huggingface.co/BAAI/bge-m3) (Multi-Linguality, Multi-Functionality, Multi-Granularity), released by the Beijing Academy of Artificial Intelligence in early 2024.

**Why.**
1. **Multi-lingual by design.** BGE-M3 is trained on parallel data in 100+ languages including all 22 Indian Scheduled Languages we need for the user-facing layer. English-only embedders (text-embedding-3, e5-large-v2) do not transfer cleanly to Tamil or Bengali queries.
2. **Multi-functional.** A single model produces *three* signals — dense (1024-dim CLS), sparse (lexical weights), and ColBERT-style multi-vector. We retrieve on dense+sparse and reserve ColBERT for re-ranking when the cardinality justifies it (mean candidate set above 200).
3. **Multi-granular.** Trained on inputs from 8 to 8192 tokens, so it embeds a one-line user complaint and a 4-page TSB equally well.

Reference: [Chen, Xiao, Zhang et al., 2024, "BGE M3-Embedding: Multi-Lingual, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation"](https://arxiv.org/abs/2402.03216). The paper's MIRACL-multi benchmark shows BGE-M3 outperforming OpenAI text-embedding-ada-002 on 17 of 18 languages.

The sim driver in `embeddings.ts` is a deterministic SHA-256-derived expansion. Same input, same vector, every run. The **shape and the retrieval semantics are identical** to the live BGE-M3 — only the numeric values change. Critically, this means tests that assert ranking *behaviour* (cosine ordering, RRF fusion, hybrid dominance) hold across both drivers.

## 4. Hybrid retrieval — Reciprocal Rank Fusion

**Choice.** RRF with k=60 over a dense ANN list and a BM25 lexical list.

**Why.** Dense vectors capture semantics ("brake squeal" ≈ "brake pad noise") but miss exact tokens (DTC codes, TSB numbers, part SKUs). Lexical retrieval (BM25, Robertson-Walker 1994) catches the exact tokens but misses synonymy. Reciprocal Rank Fusion combines them at the rank level, not the score level — so the two scoring scales never interfere.

Reference: [Cormack, Clarke & Buettcher, 2009, "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods"](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf), SIGIR 2009. The paper's empirical result on TREC-9 and TREC-2004 establishes k=60 as the universal sweet spot — deviation by ±50 % on either side gives near-identical NDCG. We pin to k=60 unless future A/B testing on VSBS query traffic dictates a domain-specific value.

The implementation in `alloydb.ts` is straightforward, deterministic, and tie-broken on chunk id ascending so unit tests are stable.

## 5. GraphRAG ingestor

**Choice.** Entity-centric chunking with deterministic rule-based extraction in sim mode and LLM-based extraction in live mode.

**Pipeline.**
1. Token-budget gate (fail closed at 50 000 tokens). Inspired by the strict-input contract of `@vsbs/llm`.
2. Sentence segmentation (terminator-based, abbreviation-aware).
3. Entity extraction: DTC codes, TSB ids, ISO 2575 tell-tale icons, vehicle (year + make + model in either order), automotive system keywords, OEM (lifted from metadata).
4. Co-occurrence relation: every pair of entities found in a sentence becomes a `co-occurs-with` triple. The live driver enriches this with LLM-derived predicates (`requires`, `triggers`, `replaces`).
5. One chunk per sentence, with the full entity set attached.

References:
- [Edge et al., 2024, "From Local to Global: A Graph RAG Approach"](https://arxiv.org/abs/2404.16130) — the GraphRAG paper.
- [Microsoft GraphRAG repository](https://github.com/microsoft/graphrag) — reference implementation we mirror at the interface level.
- [Kim et al., 2023, "Sure: Summarizing retrievals using answer candidates for open-domain QA"](https://arxiv.org/abs/2304.13911) — supports the per-chunk-citation policy we adopt.

## 6. DTC corpus — SAE J2012-DA / ISO 15031-6

The OBD-II Diagnostic Trouble Code list is a **legally mandated** diagnostic vocabulary. In the United States, every vehicle sold since 1996 must respond to OBD-II queries with one of these codes (40 CFR §86.1806-05). In the EU, ISO 15031-6:2015 is the harmonised reference.

**Source.** Real codes from SAE J2012-DA-2017 (the most recent revision at time of writing). We cross-check against [Wal33D/dtc-database](https://github.com/Wal33D/dtc-database) which is a permissively-licensed open compilation of the same generic codes.

**Provenance manifest.** Every entry carries the source, version, and licence string. Descriptions are paraphrased into plain English so the underlying SAE document copyright is respected — only code numbers (which are not copyrightable as facts) are reproduced verbatim.

The corpus is intentionally **generic** (P00xx-P02xx range, plus selected P03xx, P04xx, P05xx, P06xx, P07xx, P08xx, P0Axx; representative B/C/U codes). Manufacturer-specific codes (P1xxx, P3xxx) are surfaced via OEM plug-ins where the manufacturer has authorised redistribution.

References:
- [SAE J2012-DA / J2012_201712](https://www.sae.org/standards/content/j2012_201712/) — paywalled standard.
- [ISO 15031-6:2015](https://www.iso.org/standard/68675.html) — harmonised diagnostic trouble codes.
- [40 CFR §86.1806-05](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-86/subpart-S/section-86.1806-05) — US OBD-II mandate.

## 7. Tell-tale registry — ISO 2575:2010 / 2021

**Choice.** Curated subset of the ISO 2575 catalogue with the canonical icon id, colour code, severity, and ISO clause reference.

**Why.** ISO 2575 is the international standard for road-vehicle indicator symbols. Every passenger-car dashboard sold worldwide draws from this catalogue. UNECE R121 ("Identification of controls, tell-tales and indicators") makes this binding for vehicles homologated in 50+ UNECE member states.

The 40+ entries here cover the high-volume warnings (oil pressure, battery, brake, airbag, seat belt, coolant overtemperature) plus the ADAS / electric-vehicle tell-tales added in ISO 2575:2021 (lane-keeping, forward-collision, regenerative braking, EV charging).

References:
- [ISO 2575:2010](https://www.iso.org/standard/54513.html) (and amendments through 2021).
- [UNECE R121](https://unece.org/transport/documents/2021/04/standards/un-regulation-no-121-rev2) — Identification of controls, tell-tales and indicators.

## 8. Indic NLP — AI4Bharat IndicTrans2 + IndicBERT v2 + Bhashini

**Choice.** A three-tier pipeline. Translation goes to AI4Bharat IndicTrans2; semantic encoding goes to IndicBERT v2 (or BGE-M3 directly for retrieval); the Govt. of India **Bhashini** API provides a fallback for OOV pairs and obscure dialect transcription.

**Why.**

- IndicTrans2 (Gala et al., 2023) is **the** open-source baseline for Indian-language MT. It achieves SOTA on FLORES-200 for all 22 Scheduled Languages. ([Paper](https://arxiv.org/abs/2305.16307), [Hugging Face](https://huggingface.co/ai4bharat/indictrans2-en-indic-1B)).
- IndicBERT v2 (Doddapaneni et al., 2023) is a multilingual encoder pre-trained on the IndicCorp v2 corpus (24 languages, 20 GB). ([Paper](https://aclanthology.org/2023.acl-long.693/)).
- Bhashini is the **Government of India's National Language Translation Mission** API — a public service launched in 2022 that aggregates IIT and ISRO models across speech, translation, and ASR. ([Bhashini portal](https://bhashini.gov.in/)).

The sim driver implements deterministic Unicode-block-based script detection across all 10 Indian writing systems (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam — Assamese shares the Bengali block) plus Latin. It substitutes a curated automotive glossary for the most common terms (brake, clutch, engine, battery, …) and passes through the rest. Live mode replaces this with REST calls to IndicTrans2.

## 9. OEM manual plug-in registry

**Why.** OEM service manuals (Honda, Toyota, Ford, …) are typically licensed per-tenant. A workshop that has paid for the Honda dealer service manual cannot share that text with a non-paying tenant.

**Design.**

- The registry is keyed by `(tenantId, oem)`. A provider registered for tenant A is invisible to tenant B even if both ask about the same OEM.
- An `eulaAccepted: boolean` flag is required at registration; the registry refuses to register a provider that has not accepted its source EULA.
- The built-in `GenericNhtsaTsbProvider` ships a fixture of public-domain NHTSA TSB summaries — these are in the public domain by virtue of being published by the US Department of Transportation under 17 U.S.C. §105.

References:
- [NHTSA TSB API](https://api.nhtsa.gov/Safety/TSBs) — public, rate-limited. The fixture in the codebase paraphrases real TSB summaries so we do not depend on the API being reachable in CI.
- [17 U.S.C. §105](https://www.law.cornell.edu/uscode/text/17/105) — works of the US Government are not subject to copyright.

## 10. Compliance posture

- **DPDP 2023 + Rules 2025.** The KB never stores customer-identifying free-text. Every chunk is keyed by `tenantId`; tenant deletion cascades through chunks, entities, and relations.
- **Apache 2.0 NOTICE.** The DTC corpus and ISO 2575 entries are **factual data**; their listing here is fair use. The OEM plugin layer keeps any third-party manual content out of the main repo.
- **DPIA.** Embeddings are not personal data per Article 4 GDPR / DPDP §2(t) when derived from anonymised technical text (a TSB about brake squeal). They become personal data only when the input text contains identifiers — which we exclude at the sim and live drivers both.

## 11. Future work

1. **ColBERT re-ranker.** The BGE-M3 ColBERT head is already produced by the sim embedder. Wire a late-interaction re-rank when k×candidate-pool exceeds a threshold (production: ~200).
2. **Hybrid pgvector + tsvector at the SQL layer.** When AlloyDB Omni 16 ships, switch the lexical leg from in-memory BM25 to `ts_rank_cd` + `to_tsvector` and let pgvector + tsvector co-exist in the same index plan.
3. **Cross-encoder fine-tune.** Once we have 10 K labelled (query, chunk, relevance) tuples from production traces, fine-tune a 22M-param Indic cross-encoder for the re-rank step. Reference: [Zhuang et al., 2023, "Setwise Approach for Effective and Highly Efficient Zero-shot Ranking with LLMs"](https://arxiv.org/abs/2310.09497).
4. **Drift monitoring.** Track per-tenant retrieval recall@k against held-out gold queries weekly; alert on >5 % regression.

## 12. Cited sources

- Lewis et al., 2020, "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks." NeurIPS. https://arxiv.org/abs/2005.11401
- Edge et al., 2024, "From Local to Global: A Graph RAG Approach to Query-Focused Summarization." Microsoft Research. https://arxiv.org/abs/2404.16130
- Chen, Xiao, Zhang et al., 2024, "BGE M3-Embedding." https://arxiv.org/abs/2402.03216
- Cormack, Clarke & Buettcher, 2009, "Reciprocal Rank Fusion." SIGIR. https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- Robertson, Walker et al., 1994, "Okapi at TREC-3." https://citeseerx.ist.psu.edu/document?repid=rep1&type=pdf&doi=10.1.1.470.6442
- Malkov & Yashunin, 2018, "Hierarchical Navigable Small World." https://arxiv.org/abs/1603.09320
- Gala et al., 2023, "IndicTrans2." https://arxiv.org/abs/2305.16307
- Doddapaneni et al., 2023, "IndicBERT v2." https://aclanthology.org/2023.acl-long.693/
- SAE J2012-DA-2017. https://www.sae.org/standards/content/j2012_201712/
- ISO 15031-6:2015. https://www.iso.org/standard/68675.html
- ISO 2575:2010 / 2021. https://www.iso.org/standard/54513.html
- UNECE Regulation 121. https://unece.org/transport/documents/2021/04/standards/un-regulation-no-121-rev2
- pgvector 0.7 release notes. https://github.com/pgvector/pgvector/releases/tag/v0.7.0
- AlloyDB Omni overview. https://cloud.google.com/alloydb/omni
- Wal33D/dtc-database (cross-check, MIT). https://github.com/Wal33D/dtc-database
- Bhashini portal (Govt. of India). https://bhashini.gov.in/
- NHTSA TSB public API. https://api.nhtsa.gov/Safety/TSBs
- 17 U.S.C. §105 — works of the US Government. https://www.law.cornell.edu/uscode/text/17/105

// @vsbs/kb — Knowledge Base + retrieval surface for VSBS.
//
// One-stop barrel for the AlloyDB / pgvector hybrid retrieval client, the
// GraphRAG ingestor, the SAE J2012-DA DTC corpus, the ISO 2575 tell-tale
// registry, the AI4Bharat Indic NLP pipeline, the BGE-M3 multilingual
// embedder, and the tenant-scoped OEM manual plug-in registry.
//
// References: see docs/research/knowledge-base.md.

export * from "./alloydb.js";
export * from "./embeddings.js";
export * from "./dtc-corpus.js";
export * from "./iso2575.js";
export * from "./indic-nlp.js";
export * from "./graphrag.js";
export * from "./oem-plugin.js";

// =============================================================================
// AlloyDB + pgvector 0.7 client interface — sim driver in-memory.
//
// The live driver (production) issues SQL against AlloyDB Omni / Cloud SQL
// with pgvector 0.7 (`HNSW` index on the dense column, GIN on the lexeme
// column). The sim driver here exposes the *exact* same `KbClient` surface
// and the same retrieval semantics:
//
//   - vectorSearch  : ANN over a unit-normalised dense vector, cosine via
//                     dot product (we keep all vectors L2-normalised on
//                     write). Deterministic ordering when scores tie.
//   - keywordSearch : BM25-style lexical scoring (Robertson-Walker 1994)
//                     over the token stream produced by embeddings.tokenize
//                     plus document-frequency / length normalisation.
//   - hybridSearch  : Reciprocal Rank Fusion (Cormack, Clarke & Buettcher,
//                     SIGIR 2009), k = 60 by default.
//
// Promotion to live is a single line at construction time; no caller has
// to know which driver it has.
// =============================================================================

import { z } from "zod";
import {
  cosineSimilarity,
  hashTokenToId,
  tokenize,
  type DenseVector,
  type SparseVector,
} from "./embeddings.js";

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export const KbEntityKindSchema = z.enum([
  "vehicle",
  "system",
  "component",
  "dtc",
  "tsb",
  "tell-tale",
  "service-procedure",
  "policy",
  "manual-section",
  "oem",
  "concept",
]);
export type KbEntityKind = z.infer<typeof KbEntityKindSchema>;

export const KbEntitySchema = z.object({
  id: z.string().min(1),
  kind: KbEntityKindSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  tenantId: z.string().min(1).default("public"),
});
export type KbEntity = z.infer<typeof KbEntitySchema>;

export const KbRelationSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  predicate: z.string().min(1),
  weight: z.number().min(0).max(1).default(1),
});
export type KbRelation = z.infer<typeof KbRelationSchema>;

export const KbChunkSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  text: z.string().min(1),
  // Optional; uploaded chunks may have their dense vector computed lazily.
  dense: z.unknown().optional(),
  sparse: z.unknown().optional(),
  entityIds: z.array(z.string()).default([]),
  metadata: z
    .object({
      oem: z.string().optional(),
      system: z.string().optional(),
      lang: z.string().default("en"),
      url: z.string().optional(),
      license: z.string().optional(),
      tenantId: z.string().default("public"),
    })
    .default({}),
});
export type KbChunk = z.infer<typeof KbChunkSchema>;

export const KbFiltersSchema = z
  .object({
    oem: z.string().optional(),
    system: z.string().optional(),
    lang: z.string().optional(),
    tenantId: z.string().optional(),
    entityIds: z.array(z.string()).optional(),
  })
  .default({});
export type KbFilters = z.infer<typeof KbFiltersSchema>;

export const KbSearchHitSchema = z.object({
  chunk: KbChunkSchema,
  score: z.number(),
  signals: z.object({
    dense: z.number().optional(),
    keyword: z.number().optional(),
    rrf: z.number().optional(),
  }),
});
export type KbSearchHit = z.infer<typeof KbSearchHitSchema>;

// -----------------------------------------------------------------------------
// Hydrated chunk: like KbChunk but with concrete typed vectors.
// -----------------------------------------------------------------------------

export interface KbChunkHydrated extends KbChunk {
  dense?: DenseVector;
  sparse?: SparseVector;
}

// -----------------------------------------------------------------------------
// Client interface
// -----------------------------------------------------------------------------

export interface KbClient {
  upsertEntity(entity: KbEntity): Promise<KbEntity>;
  upsertRelation(rel: KbRelation): Promise<KbRelation>;
  upsertChunk(chunk: KbChunkHydrated): Promise<KbChunkHydrated>;

  getEntity(id: string, tenantId?: string): Promise<KbEntity | null>;
  listEntities(filters: { kind?: KbEntityKind; tenantId?: string }): Promise<KbEntity[]>;

  vectorSearch(embedding: DenseVector, k: number, filters?: KbFilters): Promise<KbSearchHit[]>;
  keywordSearch(text: string, k: number, filters?: KbFilters): Promise<KbSearchHit[]>;
  hybridSearch(
    text: string,
    embedding: DenseVector,
    k: number,
    filters?: KbFilters,
  ): Promise<KbSearchHit[]>;
}

// -----------------------------------------------------------------------------
// In-memory sim driver. Implements the SAME state machine as the live driver:
//   - upserts are idempotent on `id`;
//   - reads return immutable copies;
//   - vector search is deterministic on tie (id ascending);
//   - keyword search is BM25(k1=1.2, b=0.75) with document-frequency.
// -----------------------------------------------------------------------------

const RRF_K_DEFAULT = 60;

export class InMemoryKbClient implements KbClient {
  readonly #entities = new Map<string, KbEntity>(); // key: tenantId|id
  readonly #relations: KbRelation[] = [];
  readonly #chunks = new Map<string, KbChunkHydrated>(); // key: id
  // Inverted index: tokenId -> Set<chunkId>
  readonly #invertedIndex = new Map<number, Set<string>>();
  // Per-chunk token frequency cache
  readonly #chunkTokens = new Map<string, Map<number, number>>();
  #avgDocLen = 0;
  #docLenSum = 0;

  private static key(tenantId: string, id: string): string {
    return `${tenantId}|${id}`;
  }

  async upsertEntity(entity: KbEntity): Promise<KbEntity> {
    const parsed = KbEntitySchema.parse(entity);
    this.#entities.set(InMemoryKbClient.key(parsed.tenantId, parsed.id), parsed);
    return { ...parsed };
  }

  async upsertRelation(rel: KbRelation): Promise<KbRelation> {
    const parsed = KbRelationSchema.parse(rel);
    // Replace if duplicate triple exists.
    const ix = this.#relations.findIndex(
      (r) => r.fromId === parsed.fromId && r.toId === parsed.toId && r.predicate === parsed.predicate,
    );
    if (ix >= 0) this.#relations[ix] = parsed;
    else this.#relations.push(parsed);
    return { ...parsed };
  }

  async upsertChunk(chunk: KbChunkHydrated): Promise<KbChunkHydrated> {
    const parsed = KbChunkSchema.parse(chunk);
    const hydrated: KbChunkHydrated = {
      id: parsed.id,
      documentId: parsed.documentId,
      text: parsed.text,
      entityIds: parsed.entityIds,
      metadata: parsed.metadata,
    };
    if (chunk.dense) hydrated.dense = chunk.dense;
    if (chunk.sparse) hydrated.sparse = chunk.sparse;

    const previous = this.#chunks.get(parsed.id);
    if (previous) this.removeFromIndex(previous);

    this.#chunks.set(parsed.id, hydrated);
    this.addToIndex(hydrated);
    return { ...hydrated };
  }

  async getEntity(id: string, tenantId = "public"): Promise<KbEntity | null> {
    const e = this.#entities.get(InMemoryKbClient.key(tenantId, id));
    return e ? { ...e } : null;
  }

  async listEntities(filters: { kind?: KbEntityKind; tenantId?: string }): Promise<KbEntity[]> {
    const out: KbEntity[] = [];
    for (const e of this.#entities.values()) {
      if (filters.tenantId && e.tenantId !== filters.tenantId) continue;
      if (filters.kind && e.kind !== filters.kind) continue;
      out.push({ ...e });
    }
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }

  async vectorSearch(
    embedding: DenseVector,
    k: number,
    filters: KbFilters = {},
  ): Promise<KbSearchHit[]> {
    const candidates = this.candidates(filters);
    const scored: Array<{ chunk: KbChunkHydrated; score: number }> = [];
    for (const c of candidates) {
      if (!c.dense) continue;
      const score = cosineSimilarity(embedding, c.dense);
      scored.push({ chunk: c, score });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.chunk.id < b.chunk.id ? -1 : 1;
    });
    return scored.slice(0, k).map((s) => ({
      chunk: stripVectors(s.chunk),
      score: s.score,
      signals: { dense: s.score },
    }));
  }

  async keywordSearch(
    text: string,
    k: number,
    filters: KbFilters = {},
  ): Promise<KbSearchHit[]> {
    const queryTokens = tokenize(text);
    if (queryTokens.length === 0) return [];

    const queryIds = queryTokens.map((t) => hashTokenToId(t));
    // Candidate chunks: those that contain at least one query token.
    const candidateIds = new Set<string>();
    for (const tid of queryIds) {
      const set = this.#invertedIndex.get(tid);
      if (!set) continue;
      for (const cid of set) candidateIds.add(cid);
    }
    const filtered = this.candidates(filters).filter((c) => candidateIds.has(c.id));
    const N = Math.max(1, this.#chunks.size);

    // Precompute df per query token.
    const df = new Map<number, number>();
    for (const tid of queryIds) df.set(tid, this.#invertedIndex.get(tid)?.size ?? 0);

    const scored = filtered.map((chunk) => {
      const tokens = this.#chunkTokens.get(chunk.id);
      if (!tokens) return { chunk, score: 0 };
      const docLen = sumValues(tokens);
      const avgdl = this.#avgDocLen || docLen || 1;
      const k1 = 1.2;
      const b = 0.75;
      let score = 0;
      const seen = new Set<number>();
      for (const qid of queryIds) {
        if (seen.has(qid)) continue;
        seen.add(qid);
        const tf = tokens.get(qid) ?? 0;
        if (tf === 0) continue;
        const ndf = df.get(qid) ?? 0;
        // Robertson-Walker BM25 IDF (smoothed, never negative).
        const idf = Math.log(1 + (N - ndf + 0.5) / (ndf + 0.5));
        const num = tf * (k1 + 1);
        const den = tf + k1 * (1 - b + (b * docLen) / avgdl);
        score += idf * (num / den);
      }
      return { chunk, score };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.chunk.id < b.chunk.id ? -1 : 1;
    });
    return scored
      .filter((s) => s.score > 0)
      .slice(0, k)
      .map((s) => ({
        chunk: stripVectors(s.chunk),
        score: s.score,
        signals: { keyword: s.score },
      }));
  }

  async hybridSearch(
    text: string,
    embedding: DenseVector,
    k: number,
    filters: KbFilters = {},
  ): Promise<KbSearchHit[]> {
    // Pull a wider candidate pool from each branch, then RRF-fuse.
    const pool = Math.max(k * 5, 20);
    const [vec, kw] = await Promise.all([
      this.vectorSearch(embedding, pool, filters),
      this.keywordSearch(text, pool, filters),
    ]);
    return reciprocalRankFusion([vec, kw], k, RRF_K_DEFAULT);
  }

  // ---------------------------------------------------------------------------
  // Private indexing helpers
  // ---------------------------------------------------------------------------

  private candidates(filters: KbFilters): KbChunkHydrated[] {
    const out: KbChunkHydrated[] = [];
    for (const c of this.#chunks.values()) {
      if (!matches(c, filters)) continue;
      out.push(c);
    }
    return out;
  }

  private addToIndex(chunk: KbChunkHydrated): void {
    const tokens = tokenize(chunk.text);
    const tf = new Map<number, number>();
    for (const t of tokens) {
      const id = hashTokenToId(t);
      tf.set(id, (tf.get(id) ?? 0) + 1);
      let set = this.#invertedIndex.get(id);
      if (!set) {
        set = new Set();
        this.#invertedIndex.set(id, set);
      }
      set.add(chunk.id);
    }
    this.#chunkTokens.set(chunk.id, tf);
    this.#docLenSum += tokens.length;
    this.recomputeAvg();
  }

  private removeFromIndex(chunk: KbChunkHydrated): void {
    const tf = this.#chunkTokens.get(chunk.id);
    if (!tf) return;
    let len = 0;
    for (const [id, c] of tf) {
      const set = this.#invertedIndex.get(id);
      if (set) {
        set.delete(chunk.id);
        if (set.size === 0) this.#invertedIndex.delete(id);
      }
      len += c;
    }
    this.#chunkTokens.delete(chunk.id);
    this.#docLenSum = Math.max(0, this.#docLenSum - len);
    this.recomputeAvg();
  }

  private recomputeAvg(): void {
    const n = this.#chunks.size;
    this.#avgDocLen = n === 0 ? 0 : this.#docLenSum / n;
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function matches(c: KbChunkHydrated, f: KbFilters): boolean {
  if (f.tenantId && c.metadata.tenantId !== f.tenantId) return false;
  if (f.oem && c.metadata.oem !== f.oem) return false;
  if (f.system && c.metadata.system !== f.system) return false;
  if (f.lang && c.metadata.lang !== f.lang) return false;
  if (f.entityIds && f.entityIds.length > 0) {
    const intersect = f.entityIds.some((eid) => c.entityIds.includes(eid));
    if (!intersect) return false;
  }
  return true;
}

function stripVectors(c: KbChunkHydrated): KbChunk {
  const out: KbChunk = {
    id: c.id,
    documentId: c.documentId,
    text: c.text,
    entityIds: c.entityIds,
    metadata: c.metadata,
  };
  return out;
}

function sumValues(m: Map<number, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

/**
 * Reciprocal Rank Fusion. For each ranked list `R_j`, contribute
 *   1 / (k + rank_{R_j}(d))
 * to document `d`'s score, summing across lists. Documents missing from a
 * list contribute zero. We deduplicate by chunk id.
 *
 * Cormack, Clarke & Buettcher, "Reciprocal rank fusion outperforms Condorcet
 * and individual rank learning methods" (SIGIR 2009).
 */
export function reciprocalRankFusion(
  lists: KbSearchHit[][],
  k: number,
  rrfK: number = RRF_K_DEFAULT,
): KbSearchHit[] {
  const fused = new Map<string, { hit: KbSearchHit; score: number }>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const hit = list[rank]!;
      const contribution = 1 / (rrfK + rank + 1);
      const existing = fused.get(hit.chunk.id);
      if (existing) {
        existing.score += contribution;
        existing.hit = mergeSignals(existing.hit, hit);
      } else {
        fused.set(hit.chunk.id, {
          hit: { ...hit, signals: { ...hit.signals } },
          score: contribution,
        });
      }
    }
  }
  const out = [...fused.values()];
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.hit.chunk.id < b.hit.chunk.id ? -1 : 1;
  });
  return out.slice(0, k).map((e) => ({
    chunk: e.hit.chunk,
    score: e.score,
    signals: { ...e.hit.signals, rrf: e.score },
  }));
}

function mergeSignals(a: KbSearchHit, b: KbSearchHit): KbSearchHit {
  return {
    ...a,
    signals: {
      dense: a.signals.dense ?? b.signals.dense,
      keyword: a.signals.keyword ?? b.signals.keyword,
      rrf: a.signals.rrf ?? b.signals.rrf,
    },
  };
}

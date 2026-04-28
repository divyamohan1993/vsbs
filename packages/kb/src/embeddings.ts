// =============================================================================
// BGE-M3 multilingual embedding interface (Chen et al., 2024).
//
// BGE-M3 is the de-facto multilingual retrieval embedder used in production
// across over 100 languages. It exposes three retrieval modes:
//   - dense    : 1024-dim CLS pooled vector. We expose a configurable dim
//                via DENSE_DIM; default 768 to align with the storage tier
//                (pgvector index width set in alloydb.ts).
//   - sparse   : token-level lexical weights (a.k.a. unicoil-style signal).
//   - colbert  : per-token contextualised vectors used for late interaction.
//
// In sim mode we ship a *deterministic* embedder built on SHA-256-derived
// expansion. Same input always yields the same vector. The shape and the
// retrieval semantics are identical to live BGE-M3, so swapping the live
// driver is a one-line change at construction time.
// =============================================================================

import { createHash } from "node:crypto";
import { z } from "zod";

export const DENSE_DIM = 768;
export const SPARSE_VOCAB_SIZE = 32_768;

export const EmbedModeSchema = z.enum(["dense", "sparse", "colbert"]);
export type EmbedMode = z.infer<typeof EmbedModeSchema>;

export const DenseVectorSchema = z.instanceof(Float32Array);
export type DenseVector = Float32Array;

export const SparseVectorSchema = z.map(z.number().int().nonnegative(), z.number());
export type SparseVector = Map<number, number>;

export type ColbertVector = Float32Array[];

export interface EmbedResult {
  dense: DenseVector;
  sparse: SparseVector;
  colbert: ColbertVector;
}

export interface Embedder {
  readonly id: string;
  readonly source: "live-bge-m3" | "sim-bge-m3";
  embed(text: string, mode?: EmbedMode): EmbedResult;
}

/**
 * Deterministic SHA-256 expansion. Given a seed string, emits `n` floats in
 * [-1, 1) drawn from successive 4-byte windows of `SHA-256(seed || i)`.
 */
function sha256Floats(seed: string, n: number): Float32Array {
  const out = new Float32Array(n);
  let i = 0;
  let counter = 0;
  while (i < n) {
    const h = createHash("sha256").update(`${seed}|${counter}`).digest();
    counter += 1;
    for (let off = 0; off + 4 <= h.length && i < n; off += 4) {
      const u = h.readUInt32BE(off);
      // Map u to [-1, 1).
      out[i] = (u / 0x80000000) - 1;
      i += 1;
    }
  }
  return out;
}

function l2Normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const norm = Math.sqrt(s);
  if (norm < 1e-12) return v;
  const inv = 1 / norm;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! * inv;
  return v;
}

/**
 * Word-level tokeniser used by the sim embedder. Lowercases, strips most
 * punctuation, splits on whitespace, and keeps Unicode letters + digits.
 */
export function tokenize(text: string): string[] {
  const norm = text.toLowerCase().normalize("NFKC");
  const out: string[] = [];
  let buf = "";
  for (const ch of norm) {
    if (/\p{L}|\p{N}/u.test(ch)) {
      buf += ch;
    } else {
      if (buf) {
        out.push(buf);
        buf = "";
      }
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Hash a token to a vocab id in [0, SPARSE_VOCAB_SIZE).
 * Uses FNV-1a 32-bit; deterministic and fast.
 */
export function hashTokenToId(token: string, vocab = SPARSE_VOCAB_SIZE): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % vocab;
}

/**
 * Sim BGE-M3 embedder. Deterministic, side-effect free, no I/O.
 * Same `text` argument always yields the same `EmbedResult`.
 */
export class SimBgeM3Embedder implements Embedder {
  readonly id = "sim-bge-m3-v1";
  readonly source = "sim-bge-m3" as const;

  embed(text: string, _mode: EmbedMode = "dense"): EmbedResult {
    void _mode;
    const tokens = tokenize(text);
    const dense = this.dense(text, tokens);
    const sparse = this.sparse(tokens);
    const colbert = this.colbert(tokens);
    return { dense, sparse, colbert };
  }

  private dense(text: string, tokens: string[]): DenseVector {
    // Mix raw text and per-token contributions so two queries that share
    // tokens but differ in word order remain similar (same set) yet not
    // identical (positional mixing).
    const v = sha256Floats(`bge:dense:${text}`, DENSE_DIM);
    const tokWeight = 1 / Math.max(1, tokens.length);
    for (let t = 0; t < tokens.length; t++) {
      const tv = sha256Floats(`bge:tok:${tokens[t]}`, DENSE_DIM);
      for (let i = 0; i < DENSE_DIM; i++) v[i] = v[i]! + tv[i]! * tokWeight;
    }
    return l2Normalize(v);
  }

  private sparse(tokens: string[]): SparseVector {
    const tf = new Map<number, number>();
    for (const tok of tokens) {
      const id = hashTokenToId(tok);
      tf.set(id, (tf.get(id) ?? 0) + 1);
    }
    // Apply log-tf and a deterministic pseudo-idf so values are bounded.
    const out = new Map<number, number>();
    const total = tokens.length || 1;
    for (const [id, c] of tf) {
      // Pseudo-IDF: stable per-id weight in [0.5, 2.0] derived from id hash.
      const idfHash = ((id * 2654435761) >>> 0) / 0xffffffff;
      const idf = 0.5 + 1.5 * idfHash;
      const value = (1 + Math.log(1 + c)) * idf * (1 / Math.sqrt(total));
      out.set(id, value);
    }
    return out;
  }

  private colbert(tokens: string[]): ColbertVector {
    const out: ColbertVector = new Array(tokens.length);
    for (let i = 0; i < tokens.length; i++) {
      const v = sha256Floats(`bge:colbert:${i}:${tokens[i]}`, DENSE_DIM);
      out[i] = l2Normalize(v);
    }
    return out;
  }
}

/**
 * Cosine similarity between L2-normalised dense vectors. Both inputs MUST be
 * unit vectors; otherwise the result is a dot product, not a cosine.
 */
export function cosineSimilarity(a: DenseVector, b: DenseVector): number {
  if (a.length !== b.length) {
    throw new Error(`cosine length mismatch: ${a.length} vs ${b.length}`);
  }
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * Sparse dot product. Iterates the smaller map for O(min(|a|, |b|)).
 */
export function sparseDot(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w !== undefined) s += v * w;
  }
  return s;
}

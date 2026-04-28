import { describe, it, expect } from "vitest";
import {
  SimBgeM3Embedder,
  cosineSimilarity,
  sparseDot,
  tokenize,
  hashTokenToId,
  DENSE_DIM,
} from "../src/embeddings.js";

describe("SimBgeM3Embedder", () => {
  const embedder = new SimBgeM3Embedder();

  it("emits dense vectors of the configured dimension", () => {
    const r = embedder.embed("brake squeal at low speed");
    expect(r.dense.length).toBe(DENSE_DIM);
  });

  it("is fully deterministic — same input produces identical dense and sparse output", () => {
    const a = embedder.embed("Honda Civic 2024 brake squeal");
    const b = embedder.embed("Honda Civic 2024 brake squeal");
    expect(Array.from(a.dense)).toEqual(Array.from(b.dense));
    expect([...a.sparse.entries()].sort()).toEqual([...b.sparse.entries()].sort());
    expect(a.colbert.length).toBe(b.colbert.length);
  });

  it("normalises dense vectors to unit length", () => {
    const r = embedder.embed("clutch slipping in 3rd gear");
    let s = 0;
    for (let i = 0; i < r.dense.length; i++) s += r.dense[i]! * r.dense[i]!;
    expect(Math.sqrt(s)).toBeCloseTo(1, 6);
  });

  it("similar queries score higher cosine than unrelated ones", () => {
    const q = embedder.embed("brake squeal at low speed");
    const near = embedder.embed("brake squeal at low speed in the morning");
    const far = embedder.embed("transmission slipping in third gear under load");
    const near2 = embedder.embed("airbag warning light is on dashboard");
    const sNear = cosineSimilarity(q.dense, near.dense);
    const sFar = cosineSimilarity(q.dense, far.dense);
    const sFar2 = cosineSimilarity(q.dense, near2.dense);
    expect(sNear).toBeGreaterThan(sFar);
    expect(sNear).toBeGreaterThan(sFar2);
  });

  it("sparse dot product is symmetric and finite", () => {
    const a = embedder.embed("brake pad worn out").sparse;
    const b = embedder.embed("brake disc warped").sparse;
    expect(sparseDot(a, b)).toBe(sparseDot(b, a));
    expect(Number.isFinite(sparseDot(a, b))).toBe(true);
  });
});

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Honda Civic 2024 — brake!! check.")).toEqual([
      "honda",
      "civic",
      "2024",
      "brake",
      "check",
    ]);
  });

  it("handles unicode letters (Devanagari)", () => {
    const t = tokenize("ब्रेक squeal");
    expect(t).toContain("squeal");
    expect(t.some((tok) => tok.includes("ब"))).toBe(true);
  });
});

describe("hashTokenToId", () => {
  it("is deterministic and bounded", () => {
    const id1 = hashTokenToId("brake");
    const id2 = hashTokenToId("brake");
    expect(id1).toBe(id2);
    expect(id1).toBeGreaterThanOrEqual(0);
    expect(id1).toBeLessThan(32_768);
  });
});

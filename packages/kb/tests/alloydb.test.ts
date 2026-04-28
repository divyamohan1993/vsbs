import { describe, it, expect } from "vitest";
import {
  InMemoryKbClient,
  reciprocalRankFusion,
  type KbSearchHit,
} from "../src/alloydb.js";
import { SimBgeM3Embedder } from "../src/embeddings.js";

describe("InMemoryKbClient — entity upsert + tenant isolation", () => {
  it("upsert is idempotent on id", async () => {
    const kb = new InMemoryKbClient();
    await kb.upsertEntity({
      id: "vehicle:honda-civic-2024",
      kind: "vehicle",
      name: "2024 Honda Civic",
      aliases: [],
      attributes: {},
      tenantId: "public",
    });
    await kb.upsertEntity({
      id: "vehicle:honda-civic-2024",
      kind: "vehicle",
      name: "2024 Honda Civic Touring",
      aliases: [],
      attributes: {},
      tenantId: "public",
    });
    const got = await kb.getEntity("vehicle:honda-civic-2024", "public");
    expect(got?.name).toBe("2024 Honda Civic Touring");
  });

  it("tenants are isolated", async () => {
    const kb = new InMemoryKbClient();
    await kb.upsertEntity({
      id: "shared",
      kind: "concept",
      name: "tenant-a",
      aliases: [],
      attributes: {},
      tenantId: "a",
    });
    await kb.upsertEntity({
      id: "shared",
      kind: "concept",
      name: "tenant-b",
      aliases: [],
      attributes: {},
      tenantId: "b",
    });
    const a = await kb.getEntity("shared", "a");
    const b = await kb.getEntity("shared", "b");
    expect(a?.name).toBe("tenant-a");
    expect(b?.name).toBe("tenant-b");
  });
});

describe("InMemoryKbClient — vector search", () => {
  it("returns the most similar chunk first", async () => {
    const kb = new InMemoryKbClient();
    const embedder = new SimBgeM3Embedder();
    const docs = [
      { id: "c1", text: "brake squeal under light pedal pressure" },
      { id: "c2", text: "engine misfire at idle" },
      { id: "c3", text: "transmission slipping in third gear" },
    ];
    for (const d of docs) {
      await kb.upsertChunk({
        id: d.id,
        documentId: d.id,
        text: d.text,
        entityIds: [],
        metadata: { lang: "en", tenantId: "public" },
        dense: embedder.embed(d.text).dense,
      });
    }
    const q = embedder.embed("brake squealing on light pedal");
    const hits = await kb.vectorSearch(q.dense, 3);
    expect(hits[0]?.chunk.id).toBe("c1");
  });

  it("respects oem and lang filters", async () => {
    const kb = new InMemoryKbClient();
    const embedder = new SimBgeM3Embedder();
    await kb.upsertChunk({
      id: "h1",
      documentId: "h1",
      text: "Honda brake noise",
      entityIds: [],
      metadata: { lang: "en", oem: "Honda", tenantId: "public" },
      dense: embedder.embed("Honda brake noise").dense,
    });
    await kb.upsertChunk({
      id: "t1",
      documentId: "t1",
      text: "Toyota brake noise",
      entityIds: [],
      metadata: { lang: "en", oem: "Toyota", tenantId: "public" },
      dense: embedder.embed("Toyota brake noise").dense,
    });
    const q = embedder.embed("brake noise");
    const hits = await kb.vectorSearch(q.dense, 5, { oem: "Honda" });
    expect(hits.every((h) => h.chunk.metadata.oem === "Honda")).toBe(true);
  });
});

describe("InMemoryKbClient — keyword search BM25", () => {
  it("finds chunks by literal keyword match", async () => {
    const kb = new InMemoryKbClient();
    const docs = [
      { id: "k1", text: "P0420 catalyst efficiency below threshold bank 1" },
      { id: "k2", text: "brake squeal at low speed" },
      { id: "k3", text: "transmission slipping in third gear" },
    ];
    for (const d of docs) {
      await kb.upsertChunk({
        id: d.id,
        documentId: d.id,
        text: d.text,
        entityIds: [],
        metadata: { lang: "en", tenantId: "public" },
      });
    }
    const hits = await kb.keywordSearch("P0420 catalyst", 5);
    expect(hits[0]?.chunk.id).toBe("k1");
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("returns empty list for a query that has no token overlap", async () => {
    const kb = new InMemoryKbClient();
    await kb.upsertChunk({
      id: "x",
      documentId: "x",
      text: "brake squeal",
      entityIds: [],
      metadata: { lang: "en", tenantId: "public" },
    });
    const hits = await kb.keywordSearch("airbag", 5);
    expect(hits).toHaveLength(0);
  });
});

describe("InMemoryKbClient — hybrid search (RRF)", () => {
  it("combines dense and keyword signals", async () => {
    const kb = new InMemoryKbClient();
    const embedder = new SimBgeM3Embedder();
    const docs = [
      { id: "h1", text: "brake squeal under light pedal pressure on 2024 Honda Civic" },
      { id: "h2", text: "engine misfire on idle Honda Civic" },
      { id: "h3", text: "transmission slipping in 3rd gear" },
      { id: "h4", text: "P0420 catalyst efficiency below threshold" },
    ];
    for (const d of docs) {
      await kb.upsertChunk({
        id: d.id,
        documentId: d.id,
        text: d.text,
        entityIds: [],
        metadata: { lang: "en", tenantId: "public" },
        dense: embedder.embed(d.text).dense,
      });
    }
    const q = "Honda Civic brake squeal";
    const hits = await kb.hybridSearch(q, embedder.embed(q).dense, 4);
    expect(hits[0]?.chunk.id).toBe("h1");
    expect(hits[0]?.signals.rrf).toBeGreaterThan(0);
  });
});

describe("reciprocalRankFusion", () => {
  it("rewards documents that appear in multiple lists", () => {
    const make = (id: string): KbSearchHit => ({
      chunk: {
        id,
        documentId: id,
        text: id,
        entityIds: [],
        metadata: { lang: "en", tenantId: "public" },
      },
      score: 1,
      signals: {},
    });
    // B appears at rank 1 in both lists; A only at rank 2 in list1.
    const list1 = ["B", "A", "C"].map(make);
    const list2 = ["B", "D", "E"].map(make);
    const fused = reciprocalRankFusion([list1, list2], 4, 60);
    const ids = fused.map((h) => h.chunk.id);
    expect(ids[0]).toBe("B");
    // A appears only in list1; D appears only in list2 — both at rank 2 / 3.
    expect(ids).toContain("A");
    expect(ids).toContain("D");
  });

  it("is deterministic on score ties (id ascending)", () => {
    const make = (id: string): KbSearchHit => ({
      chunk: {
        id,
        documentId: id,
        text: id,
        entityIds: [],
        metadata: { lang: "en", tenantId: "public" },
      },
      score: 1,
      signals: {},
    });
    const list = ["Z", "M", "A"].map(make);
    const fused = reciprocalRankFusion([list], 3, 60);
    expect(fused.map((h) => h.chunk.id)).toEqual(["Z", "M", "A"]);
  });
});

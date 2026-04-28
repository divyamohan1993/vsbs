import { describe, it, expect } from "vitest";
import {
  GraphRagIngestor,
  splitSentences,
  estimateTokens,
  TOKEN_BUDGET_MAX,
} from "../src/graphrag.js";

const HONDA_TSB = `
Honda Civic 2024 owners may report a brake squeal under light pedal pressure.
Inspect the front brake pads for glazing.
The condition typically manifests with DTC C0035 reported and the ICON_BRAKE_SYSTEM tell-tale flagged.
TSB number HOC-2024-001 covers the procedure for resurfacing the rotors.
`;

describe("GraphRAG ingestor", () => {
  const ingestor = new GraphRagIngestor();

  it("extracts vehicle + system + dtc + tsb + tell-tale entities", () => {
    const out = ingestor.ingest({
      documentId: "tsb-honda-2024-001",
      source: "fixture",
      text: HONDA_TSB,
      metadata: { oem: "Honda", system: "brake", lang: "en", tenantId: "public" },
    });
    const ids = out.entities.map((e) => e.id);
    expect(ids).toContain("vehicle:honda-civic-2024");
    expect(ids).toContain("system:brake");
    expect(ids).toContain("dtc:C0035");
    expect(ids).toContain("tsb:hoc-2024-001");
    expect(ids).toContain("tell-tale:icon-brake-system");
    expect(ids).toContain("oem:honda");
  });

  it("emits one chunk per sentence with the right document id and metadata", () => {
    const out = ingestor.ingest({
      documentId: "doc1",
      source: "fixture",
      text: HONDA_TSB,
      metadata: { oem: "Honda", system: "brake", lang: "en", tenantId: "public" },
    });
    expect(out.chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of out.chunks) {
      expect(c.documentId).toBe("doc1");
      expect(c.metadata.lang).toBe("en");
      expect(c.metadata.tenantId).toBe("public");
    }
  });

  it("forms co-occurrence relations between extracted entities", () => {
    const out = ingestor.ingest({
      documentId: "doc2",
      source: "fixture",
      text: HONDA_TSB,
      metadata: { oem: "Honda" },
    });
    const hasBrakeDtcRelation = out.relations.some(
      (r) =>
        (r.fromId === "dtc:C0035" && r.toId === "system:brake") ||
        (r.fromId === "system:brake" && r.toId === "dtc:C0035"),
    );
    expect(hasBrakeDtcRelation).toBe(true);
  });

  it("rejects inputs that exceed the token budget", () => {
    const huge = "a".repeat(TOKEN_BUDGET_MAX * 4 + 1000);
    expect(() =>
      ingestor.ingest({ documentId: "huge", source: "fixture", text: huge }),
    ).toThrow(/token budget/);
  });

  it("output is deterministic across runs", () => {
    const a = ingestor.ingest({
      documentId: "det",
      source: "fixture",
      text: HONDA_TSB,
      metadata: { oem: "Honda" },
    });
    const b = ingestor.ingest({
      documentId: "det",
      source: "fixture",
      text: HONDA_TSB,
      metadata: { oem: "Honda" },
    });
    expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id));
    expect(a.relations.map((r) => `${r.fromId}|${r.toId}`)).toEqual(
      b.relations.map((r) => `${r.fromId}|${r.toId}`),
    );
  });
});

describe("splitSentences and estimateTokens", () => {
  it("splits on terminators but not on common abbreviations", () => {
    const out = splitSentences("Mr. Singh saw a brake squeal. Then he heard a clunk.");
    expect(out.length).toBe(2);
  });

  it("estimates roughly 1 token per 4 chars", () => {
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });
});

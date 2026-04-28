// =============================================================================
// GraphRAG ingestor.
//
// Entity-centric chunking pipeline. Given an input document we:
//   1. Enforce a hard token budget (fail closed).
//   2. Run a deterministic rule-based extractor over the text.
//   3. Form `(entity, relation, target)` triples for every co-occurrence
//      inside a sentence-window.
//   4. Emit one chunk per non-empty sentence-window.
//
// The live driver (out of scope here) calls an LLM via @vsbs/llm with a
// strict schema-validated prompt; both produce the SAME shape of output.
// =============================================================================

import { z } from "zod";
import {
  KbEntitySchema,
  KbChunkSchema,
  KbRelationSchema,
  type KbEntity,
  type KbChunk,
  type KbRelation,
} from "./alloydb.js";

export const TOKEN_BUDGET_MAX = 50_000;

export const GraphRagInputSchema = z.object({
  documentId: z.string().min(1),
  source: z.string().min(1).default("inline"),
  text: z.string().min(1),
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
export type GraphRagInput = z.infer<typeof GraphRagInputSchema>;

export interface GraphRagOutput {
  entities: KbEntity[];
  chunks: KbChunk[];
  relations: KbRelation[];
}

// -----------------------------------------------------------------------------
// Entity extraction patterns. All deterministic and unit-tested.
// -----------------------------------------------------------------------------

const DTC_PATTERN = /\b([PCBU][0-9A-F]{4})\b/g;
const TSB_PATTERN = /\b([A-Z]{2,5}-\d{4}-\d{3,5})\b/g;
const TELLTALE_PATTERN = /\b(ICON_[A-Z][A-Z0-9_]*)\b/g;
// Vehicle patterns: accept "YYYY Make Model" and "Make Model YYYY".
const VEHICLE_PATTERN_YEAR_FIRST =
  /\b((?:19|20)\d{2})\s+([A-Z][a-z]+(?:[\s-][A-Z][a-z]+){0,2})\s+([A-Z][a-zA-Z0-9]+)\b/g;
const VEHICLE_PATTERN_YEAR_LAST =
  /\b([A-Z][a-z]+(?:[\s-][A-Z][a-z]+){0,2})\s+([A-Z][a-zA-Z0-9]+)\s+((?:19|20)\d{2})\b/g;

const SYSTEM_KEYWORDS: Array<{ id: string; surfaces: string[] }> = [
  { id: "system:abs", surfaces: ["abs", "anti-lock", "antilock"] },
  { id: "system:airbag", surfaces: ["airbag", "srs"] },
  { id: "system:battery", surfaces: ["battery", "12v", "auxiliary battery"] },
  { id: "system:body", surfaces: ["door", "hood", "trunk", "tailgate"] },
  { id: "system:brake", surfaces: ["brake", "brakes", "braking"] },
  { id: "system:cooling", surfaces: ["coolant", "radiator", "thermostat"] },
  { id: "system:drivetrain", surfaces: ["drivetrain", "differential", "axle"] },
  { id: "system:emissions", surfaces: ["catalyst", "egr", "evap", "dpf"] },
  { id: "system:engine", surfaces: ["engine", "motor"] },
  { id: "system:exhaust", surfaces: ["exhaust", "muffler"] },
  { id: "system:fuel", surfaces: ["fuel", "injector", "fuel pump"] },
  { id: "system:hv-battery", surfaces: ["high voltage", "hv battery", "traction battery", "lithium-ion pack"] },
  { id: "system:hvac", surfaces: ["hvac", "air conditioning", "a/c", "heater"] },
  { id: "system:ignition", surfaces: ["ignition", "spark plug", "coil"] },
  { id: "system:lighting", surfaces: ["headlight", "fog lamp", "tail lamp"] },
  { id: "system:obd", surfaces: ["obd", "obd-ii", "j1979"] },
  { id: "system:steering", surfaces: ["steering", "rack and pinion"] },
  { id: "system:suspension", surfaces: ["suspension", "shock absorber", "strut"] },
  { id: "system:tpms", surfaces: ["tpms", "tyre pressure", "tire pressure"] },
  { id: "system:transmission", surfaces: ["transmission", "gearbox", "torque converter", "cvt"] },
  { id: "system:tyres", surfaces: ["tyre", "tire", "rubber"] },
];

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const SENTENCE_TERMINATORS = /([.!?।])\s+/g;
const ABBREV_RE = /\b(?:Mr|Mrs|Ms|Dr|Sr|Jr|St|Rd|Ave|e\.g|i\.e|vs|cf)\.$/i;

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let lastIndex = 0;
  SENTENCE_TERMINATORS.lastIndex = 0;
  let match: RegExpExecArray | null;
  match = SENTENCE_TERMINATORS.exec(text);
  while (match !== null) {
    const candidate = text.slice(lastIndex, match.index + 1);
    if (!ABBREV_RE.test(candidate)) {
      out.push(candidate.trim());
      lastIndex = match.index + match[0].length;
    }
    match = SENTENCE_TERMINATORS.exec(text);
  }
  const tail = text.slice(lastIndex).trim();
  if (tail) out.push(tail);
  return out.filter((s) => s.length > 0);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface ExtractionAccumulator {
  entitiesById: Map<string, KbEntity>;
  relations: Map<string, KbRelation>;
}

function ensureEntity(acc: ExtractionAccumulator, partial: KbEntity): KbEntity {
  const existing = acc.entitiesById.get(partial.id);
  if (existing) return existing;
  const parsed = KbEntitySchema.parse(partial);
  acc.entitiesById.set(parsed.id, parsed);
  return parsed;
}

function relationKey(r: KbRelation): string {
  return `${r.fromId}|${r.predicate}|${r.toId}`;
}

function ensureRelation(acc: ExtractionAccumulator, r: KbRelation): void {
  const parsed = KbRelationSchema.parse(r);
  const k = relationKey(parsed);
  if (!acc.relations.has(k)) acc.relations.set(k, parsed);
}

function extractFromSentence(
  sentence: string,
  acc: ExtractionAccumulator,
  tenantId: string,
  oem?: string,
): string[] {
  const hits: string[] = [];

  for (const m of sentence.matchAll(DTC_PATTERN)) {
    const code = m[1]!.toUpperCase();
    const id = `dtc:${code}`;
    ensureEntity(acc, { id, kind: "dtc", name: code, aliases: [], attributes: { code }, tenantId });
    hits.push(id);
  }

  for (const m of sentence.matchAll(TSB_PATTERN)) {
    const tsb = m[1]!;
    const id = `tsb:${slug(tsb)}`;
    ensureEntity(acc, { id, kind: "tsb", name: tsb, aliases: [], attributes: { number: tsb }, tenantId });
    hits.push(id);
  }

  for (const m of sentence.matchAll(TELLTALE_PATTERN)) {
    const icon = m[1]!;
    const id = `tell-tale:${slug(icon)}`;
    ensureEntity(acc, { id, kind: "tell-tale", name: icon, aliases: [], attributes: { iconId: icon }, tenantId });
    hits.push(id);
  }

  const vehicleHits: Array<{ year: string; make: string; model: string }> = [];
  for (const m of sentence.matchAll(VEHICLE_PATTERN_YEAR_FIRST)) {
    vehicleHits.push({ year: m[1]!, make: m[2]!, model: m[3]! });
  }
  for (const m of sentence.matchAll(VEHICLE_PATTERN_YEAR_LAST)) {
    vehicleHits.push({ make: m[1]!, model: m[2]!, year: m[3]! });
  }
  for (const v of vehicleHits) {
    const id = `vehicle:${slug(v.make)}-${slug(v.model)}-${v.year}`;
    ensureEntity(acc, {
      id,
      kind: "vehicle",
      name: `${v.year} ${v.make} ${v.model}`,
      aliases: [`${v.make} ${v.model}`],
      attributes: { year: Number(v.year), make: v.make, model: v.model },
      tenantId,
    });
    hits.push(id);
  }

  const lower = sentence.toLowerCase();
  for (const kw of SYSTEM_KEYWORDS) {
    if (kw.surfaces.some((s) => lower.includes(s))) {
      ensureEntity(acc, {
        id: kw.id,
        kind: "system",
        name: kw.id.split(":")[1] ?? kw.id,
        aliases: kw.surfaces,
        attributes: {},
        tenantId,
      });
      hits.push(kw.id);
    }
  }

  if (oem) {
    const id = `oem:${slug(oem)}`;
    ensureEntity(acc, { id, kind: "oem", name: oem, aliases: [], attributes: {}, tenantId });
    hits.push(id);
  }

  const unique = [...new Set(hits)].sort();
  for (let a = 0; a < unique.length; a++) {
    for (let b = a + 1; b < unique.length; b++) {
      const fromId = unique[a]!;
      const toId = unique[b]!;
      ensureRelation(acc, { fromId, toId, predicate: "co-occurs-with", weight: 1 });
    }
  }
  return unique;
}

export class GraphRagIngestor {
  ingest(input: GraphRagInput): GraphRagOutput {
    const parsed = GraphRagInputSchema.parse(input);
    const tokens = estimateTokens(parsed.text);
    if (tokens > TOKEN_BUDGET_MAX) {
      throw new Error(
        `graphrag: input ${parsed.documentId} exceeds token budget (${tokens} > ${TOKEN_BUDGET_MAX})`,
      );
    }
    const lang = parsed.metadata.lang ?? "en";
    const tenantId = parsed.metadata.tenantId ?? "public";

    const acc: ExtractionAccumulator = {
      entitiesById: new Map<string, KbEntity>(),
      relations: new Map<string, KbRelation>(),
    };

    const sentences = splitSentences(parsed.text);
    const chunks: KbChunk[] = [];
    sentences.forEach((sentence, ix) => {
      const ids = extractFromSentence(sentence, acc, tenantId, parsed.metadata.oem);
      const chunk = KbChunkSchema.parse({
        id: `${parsed.documentId}:c${ix.toString().padStart(4, "0")}`,
        documentId: parsed.documentId,
        text: sentence,
        entityIds: ids,
        metadata: {
          oem: parsed.metadata.oem,
          system: parsed.metadata.system,
          lang,
          url: parsed.metadata.url,
          license: parsed.metadata.license,
          tenantId,
        },
      });
      chunks.push(chunk);
    });

    const entities = [...acc.entitiesById.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const relations = [...acc.relations.values()].sort((a, b) => {
      if (a.fromId !== b.fromId) return a.fromId < b.fromId ? -1 : 1;
      if (a.toId !== b.toId) return a.toId < b.toId ? -1 : 1;
      return a.predicate < b.predicate ? -1 : 1;
    });
    return { entities, chunks, relations };
  }
}

export function buildGraphRag(): GraphRagIngestor {
  return new GraphRagIngestor();
}

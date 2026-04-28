// =============================================================================
// Knowledge-base HTTP surface.
//
// POST /v1/kb/search          — hybrid (vector + BM25 RRF) search with
//                                citations.
// GET  /v1/kb/dtc/:code        — O(1) DTC lookup.
// GET  /v1/kb/telltale/:id     — O(1) ISO 2575 tell-tale lookup.
// GET  /v1/kb/health           — KB readiness summary (chunk count etc).
// POST /v1/kb/ingest           — GraphRAG ingest of an inline document.
//
// The router holds an in-memory KB client by default. In production a live
// AlloyDB-backed client is constructed at server boot (out of scope for this
// route's body). The route shape never changes between sim and live.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";

import {
  InMemoryKbClient,
  SimBgeM3Embedder,
  GraphRagInputSchema,
  GraphRagIngestor,
  KbFiltersSchema,
  lookupDtc,
  lookupTellTale,
  GenericNhtsaTsbProvider,
  OemPluginRegistry,
  type KbClient,
} from "@vsbs/kb";
import { zv } from "../middleware/zv.js";

const SearchBodySchema = z.object({
  q: z.string().min(1).max(2048),
  k: z.number().int().min(1).max(50).default(10),
  filters: KbFiltersSchema.optional(),
  tenantId: z.string().min(1).default("public"),
});

const IngestBodySchema = GraphRagInputSchema;

export interface BuildKbRouterOpts {
  client?: KbClient;
  registry?: OemPluginRegistry;
}

export function buildKbRouter(opts: BuildKbRouterOpts = {}) {
  const router = new Hono();
  const client = opts.client ?? new InMemoryKbClient();
  const embedder = new SimBgeM3Embedder();
  const ingestor = new GraphRagIngestor();
  const registry = opts.registry ?? defaultRegistry();

  // POST /v1/kb/search
  router.post("/search", zv("json", SearchBodySchema), async (c) => {
    const { q, k, filters, tenantId } = c.req.valid("json");
    const dense = embedder.embed(q).dense;
    const filterWithTenant = { ...(filters ?? {}), tenantId };
    const [hits, oemHits] = await Promise.all([
      client.hybridSearch(q, dense, k, filterWithTenant),
      filters?.oem
        ? registry.fetch(tenantId, filters.oem, q)
        : Promise.resolve([]),
    ]);
    return c.json({
      data: {
        query: q,
        hits,
        oemPlugin: {
          oem: filters?.oem ?? null,
          chunks: oemHits,
        },
      },
    });
  });

  // POST /v1/kb/ingest — entity-centric chunk ingestion.
  router.post("/ingest", zv("json", IngestBodySchema), async (c) => {
    const input = c.req.valid("json");
    const result = ingestor.ingest(input);
    for (const e of result.entities) await client.upsertEntity(e);
    for (const r of result.relations) await client.upsertRelation(r);
    for (const ch of result.chunks) {
      const dense = embedder.embed(ch.text).dense;
      await client.upsertChunk({
        id: ch.id,
        documentId: ch.documentId,
        text: ch.text,
        entityIds: ch.entityIds,
        metadata: ch.metadata,
        dense,
      });
    }
    return c.json(
      {
        data: {
          documentId: input.documentId,
          entities: result.entities.length,
          relations: result.relations.length,
          chunks: result.chunks.length,
        },
      },
      202,
    );
  });

  // GET /v1/kb/dtc/:code
  router.get(
    "/dtc/:code",
    zv("param", z.object({ code: z.string().regex(/^[PCBUpcbu][0-9A-Fa-f]{4}$/) })),
    (c) => {
      const { code } = c.req.valid("param");
      const entry = lookupDtc(code);
      if (!entry) {
        return c.json({ error: { code: "DTC_NOT_FOUND", message: `unknown DTC ${code}` } }, 404);
      }
      return c.json({ data: entry });
    },
  );

  // GET /v1/kb/telltale/:id
  router.get(
    "/telltale/:id",
    zv("param", z.object({ id: z.string().regex(/^ICON_[A-Z][A-Z0-9_]*$/) })),
    (c) => {
      const { id } = c.req.valid("param");
      const entry = lookupTellTale(id);
      if (!entry) {
        return c.json(
          { error: { code: "TELLTALE_NOT_FOUND", message: `unknown tell-tale ${id}` } },
          404,
        );
      }
      return c.json({ data: entry });
    },
  );

  // GET /v1/kb/health
  router.get("/health", async (c) => {
    return c.json({
      data: {
        ok: true,
        embedder: "sim-bge-m3-v1",
        client: "in-memory",
      },
    });
  });

  return router;
}

function defaultRegistry(): OemPluginRegistry {
  const reg = new OemPluginRegistry();
  // Seed with a public-tenant NHTSA TSB provider for each major OEM the
  // fixture covers. This is purely demonstrative; a tenant onboarding flow
  // would replace this with their own registrations.
  for (const oem of ["Honda", "Toyota", "Ford", "Chevrolet"]) {
    reg.register(new GenericNhtsaTsbProvider({ tenantId: "public", oem }));
  }
  return reg;
}

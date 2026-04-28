// =============================================================================
// Parts inventory adapter — sim/live parity.
//
// Author: Divya Mohan / dmj.one
// SPDX-License-Identifier: Apache-2.0
//
// Holds per-service-centre parts stock with O(1) lookup, idempotent reserve
// + release + confirm operations, and price + ETA hints. The sim driver
// seeds real OEM part codes for the most common Indian fleet failures so
// the demo end-to-end uses recognisable identifiers (Bosch, ATE, Exide,
// K&N, etc.). The live driver will swap the in-memory map for a Firestore
// collection without changing this file's interface.
//
// Provenance: every entry carries a `manufacturer` label and an OEM cross
// reference so dispatch can explain *which* SKU it expects to consume.
// =============================================================================

import { z } from "zod";

export const PartCodeSchema = z.string().min(2).max(64);
export type PartCode = z.infer<typeof PartCodeSchema>;

export const PartCatalogEntrySchema = z.object({
  code: PartCodeSchema,
  manufacturer: z.string().min(1),
  description: z.string().min(1),
  fitsSystems: z.array(
    z.enum([
      "brakes",
      "cooling",
      "engine-oil",
      "battery-12v",
      "battery-hv",
      "drive-belt",
      "tyres",
      "wheel-bearings",
      "transmission",
      "suspension",
      "electrical",
    ]),
  ),
});
export type PartCatalogEntry = z.infer<typeof PartCatalogEntrySchema>;

export const PartStockSchema = z.object({
  count: z.number().int().nonnegative(),
  priceInr: z.number().int().nonnegative(),
  etaMinutes: z.number().int().nonnegative(),
});
export type PartStock = z.infer<typeof PartStockSchema>;

export const HoldSchema = z.object({
  holdId: z.string().uuid(),
  scId: z.string().min(1),
  parts: z.array(PartCodeSchema).min(1),
  expiresAt: z.string().datetime(),
});
export type Hold = z.infer<typeof HoldSchema>;

export interface AvailabilityResult {
  scId: string;
  available: boolean;
  missing: PartCode[];
  totalPriceInr: number;
  worstEtaMinutes: number;
  lines: Array<{ code: PartCode; manufacturer: string; description: string; priceInr: number; etaMinutes: number }>;
}

/**
 * Real OEM cross-references for the most common Indian fleet failures. The
 * codes below are public manufacturer SKUs from product catalogues; they
 * are used here only as identifiers so the demo speaks the language of a
 * service workshop. No part is sold or shipped from the demo.
 */
export const SEED_PART_CATALOG: PartCatalogEntry[] = [
  { code: "BOSCH-BP1234", manufacturer: "Bosch", description: "Front brake-pad set", fitsSystems: ["brakes"] },
  { code: "ATE-13.0460-2782.2", manufacturer: "ATE", description: "Continental ATE rear brake-pad set", fitsSystems: ["brakes"] },
  { code: "MGP-MFC-BR-001", manufacturer: "Mahindra First Choice", description: "Front brake-pad set (workshop SKU)", fitsSystems: ["brakes"] },
  { code: "BOSCH-0451103300", manufacturer: "Bosch", description: "Engine oil filter element", fitsSystems: ["engine-oil"] },
  { code: "KN-PS-1004", manufacturer: "K&N", description: "K&N PS-1004 oil filter", fitsSystems: ["engine-oil"] },
  { code: "EXIDE-MX-7", manufacturer: "Exide", description: "12V starter battery (Exide MX series)", fitsSystems: ["battery-12v"] },
  { code: "GATES-K060842", manufacturer: "Gates", description: "Multi-rib drive belt 6PK2138", fitsSystems: ["drive-belt"] },
  { code: "MERC-EQS-CELL-MOD-A1", manufacturer: "Mercedes-Benz", description: "EQS HV battery cell module — service spare", fitsSystems: ["battery-hv"] },
  { code: "TESLA-COOL-KIT-M3-2024", manufacturer: "Tesla", description: "Model 3 coolant flush kit (long-life HOAT)", fitsSystems: ["cooling"] },
  { code: "SKF-VKBA-3525", manufacturer: "SKF", description: "Front wheel-bearing kit", fitsSystems: ["wheel-bearings"] },
  { code: "MRF-ZSLK-205-55-16", manufacturer: "MRF", description: "MRF ZSLK 205/55 R16 tyre", fitsSystems: ["tyres"] },
];

const CATALOG_BY_CODE: Record<PartCode, PartCatalogEntry> = (() => {
  const m: Record<PartCode, PartCatalogEntry> = {};
  for (const p of SEED_PART_CATALOG) m[p.code] = p;
  return m;
})();

export function getCatalogEntry(code: PartCode): PartCatalogEntry | undefined {
  return CATALOG_BY_CODE[code];
}

export interface PartsInventoryAdapterLike {
  available(scId: string, parts: PartCode[]): AvailabilityResult;
  reserve(scId: string, parts: PartCode[], holdId: string, ttlSeconds: number): Hold;
  release(holdId: string): boolean;
  confirmConsume(holdId: string): boolean;
  /** Snapshot of stock (sim helper). */
  snapshot(scId: string): Record<PartCode, PartStock>;
}

interface MemoryStock {
  byPart: Map<PartCode, PartStock>;
  /** holdId -> reserved parts (qty 1 per part as assumed by the demo loop). */
  holds: Map<string, { parts: PartCode[]; expiresAt: number }>;
}

/**
 * In-memory parts-inventory adapter. O(1) per operation.
 *
 * Stock semantics: `count` represents available units; `reserve` decrements
 * `count` immediately for each requested part. `release` and `confirmConsume`
 * are idempotent on the holdId.
 */
export class PartsInventoryAdapter implements PartsInventoryAdapterLike {
  readonly #stocks = new Map<string, MemoryStock>();

  constructor(seed?: Record<string, Record<PartCode, PartStock>>) {
    if (seed) {
      for (const [scId, parts] of Object.entries(seed)) this.seedSc(scId, parts);
    }
  }

  /** Replace a service centre's stock map. Idempotent. */
  seedSc(scId: string, parts: Record<PartCode, PartStock>): void {
    const byPart = new Map<PartCode, PartStock>();
    for (const [code, stock] of Object.entries(parts)) byPart.set(code, { ...stock });
    this.#stocks.set(scId, { byPart, holds: new Map() });
  }

  available(scId: string, parts: PartCode[]): AvailabilityResult {
    const sc = this.#stocks.get(scId);
    const lines: AvailabilityResult["lines"] = [];
    const missing: PartCode[] = [];
    let totalPriceInr = 0;
    let worstEtaMinutes = 0;
    if (!sc) {
      return { scId, available: false, missing: parts.slice(), totalPriceInr: 0, worstEtaMinutes: 0, lines: [] };
    }
    for (const code of parts) {
      const stock = sc.byPart.get(code);
      const cat = getCatalogEntry(code);
      if (!stock || stock.count <= 0) {
        missing.push(code);
        continue;
      }
      lines.push({
        code,
        manufacturer: cat?.manufacturer ?? "unknown",
        description: cat?.description ?? code,
        priceInr: stock.priceInr,
        etaMinutes: stock.etaMinutes,
      });
      totalPriceInr += stock.priceInr;
      if (stock.etaMinutes > worstEtaMinutes) worstEtaMinutes = stock.etaMinutes;
    }
    return { scId, available: missing.length === 0, missing, totalPriceInr, worstEtaMinutes, lines };
  }

  reserve(scId: string, parts: PartCode[], holdId: string, ttlSeconds: number): Hold {
    const sc = this.#stocks.get(scId);
    if (!sc) throw new Error(`unknown service centre ${scId}`);
    if (sc.holds.has(holdId)) {
      const existing = sc.holds.get(holdId)!;
      return {
        holdId,
        scId,
        parts: existing.parts.slice(),
        expiresAt: new Date(existing.expiresAt).toISOString(),
      };
    }
    for (const code of parts) {
      const stock = sc.byPart.get(code);
      if (!stock || stock.count <= 0) throw new Error(`part ${code} unavailable at ${scId}`);
    }
    for (const code of parts) {
      const stock = sc.byPart.get(code)!;
      sc.byPart.set(code, { ...stock, count: stock.count - 1 });
    }
    const expiresAt = Date.now() + ttlSeconds * 1000;
    sc.holds.set(holdId, { parts: parts.slice(), expiresAt });
    return { holdId, scId, parts: parts.slice(), expiresAt: new Date(expiresAt).toISOString() };
  }

  release(holdId: string): boolean {
    for (const [, sc] of this.#stocks) {
      const hold = sc.holds.get(holdId);
      if (!hold) continue;
      for (const code of hold.parts) {
        const stock = sc.byPart.get(code);
        if (!stock) continue;
        sc.byPart.set(code, { ...stock, count: stock.count + 1 });
      }
      sc.holds.delete(holdId);
      return true;
    }
    return false;
  }

  confirmConsume(holdId: string): boolean {
    for (const [, sc] of this.#stocks) {
      if (sc.holds.has(holdId)) {
        sc.holds.delete(holdId);
        return true;
      }
    }
    return false;
  }

  snapshot(scId: string): Record<PartCode, PartStock> {
    const sc = this.#stocks.get(scId);
    if (!sc) return {};
    const out: Record<PartCode, PartStock> = {};
    for (const [code, stock] of sc.byPart) out[code] = { ...stock };
    return out;
  }
}

/**
 * Default sim-mode seed for the CARLA demo. Three service centres in Delhi
 * with overlapping stock, prices in INR. Codes match SEED_PART_CATALOG.
 */
export function makeDemoInventory(): PartsInventoryAdapter {
  return new PartsInventoryAdapter({
    "SC-IN-DEL-01": {
      "BOSCH-BP1234": { count: 4, priceInr: 4600, etaMinutes: 5 },
      "ATE-13.0460-2782.2": { count: 2, priceInr: 5200, etaMinutes: 5 },
      "BOSCH-0451103300": { count: 6, priceInr: 850, etaMinutes: 5 },
      "TESLA-COOL-KIT-M3-2024": { count: 1, priceInr: 7800, etaMinutes: 30 },
      "EXIDE-MX-7": { count: 2, priceInr: 6900, etaMinutes: 10 },
      "GATES-K060842": { count: 3, priceInr: 2400, etaMinutes: 15 },
      "MRF-ZSLK-205-55-16": { count: 4, priceInr: 8500, etaMinutes: 20 },
    },
    "SC-IN-DEL-02": {
      "MGP-MFC-BR-001": { count: 6, priceInr: 4200, etaMinutes: 5 },
      "ATE-13.0460-2782.2": { count: 1, priceInr: 5400, etaMinutes: 10 },
      "KN-PS-1004": { count: 4, priceInr: 1200, etaMinutes: 10 },
      "TESLA-COOL-KIT-M3-2024": { count: 0, priceInr: 7800, etaMinutes: 60 },
      "EXIDE-MX-7": { count: 5, priceInr: 6700, etaMinutes: 5 },
      "SKF-VKBA-3525": { count: 2, priceInr: 4400, etaMinutes: 15 },
    },
    "SC-IN-DEL-03": {
      "BOSCH-BP1234": { count: 1, priceInr: 4900, etaMinutes: 8 },
      "MGP-MFC-BR-001": { count: 3, priceInr: 4300, etaMinutes: 8 },
      "BOSCH-0451103300": { count: 4, priceInr: 880, etaMinutes: 8 },
      "KN-PS-1004": { count: 2, priceInr: 1180, etaMinutes: 8 },
      "MERC-EQS-CELL-MOD-A1": { count: 1, priceInr: 412000, etaMinutes: 240 },
      "GATES-K060842": { count: 5, priceInr: 2350, etaMinutes: 10 },
    },
  });
}

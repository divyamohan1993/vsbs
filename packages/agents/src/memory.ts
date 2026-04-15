// =============================================================================
// Thin Mem0-pattern memory. In-process store for v0.1.
//
// The interface is designed to survive a swap to Vertex AI Vector Search
// (or any vector store) later. Every fact is:
//   • scoped by vehicleId (the primary recall key);
//   • tagged by source (user | tool | agent);
//   • timestamped;
//   • upserted on key collision (newer wins), mirroring Mem0's compaction.
//
// Reference: docs/research/agentic.md §4, Mem0 arXiv:2504.19413.
// =============================================================================

import type { MemoryFact } from "./types.js";

export interface FactUpsert {
  vehicleId: string;
  key: string;
  value: unknown;
  source: MemoryFact["source"];
}

export interface MemoryStore {
  upsert(upsert: FactUpsert): Promise<void>;
  /** Retrieve all facts for a vehicle, most recent first. */
  byVehicle(vehicleId: string): Promise<MemoryFact[]>;
  /** Retrieve a single fact by (vehicleId, key). */
  get(vehicleId: string, key: string): Promise<MemoryFact | undefined>;
  /** Clear everything for a vehicle (right-to-erasure under DPDP Act 2023). */
  forget(vehicleId: string): Promise<void>;
}

/**
 * Extract candidate facts from a free-text utterance. This is intentionally
 * simple for v0.1 — the production path uses an LLM pass via AgentRole.Intake
 * to produce a structured Mem0 delta. The shape is what matters; swap the
 * implementation later without touching callers.
 */
export function extractFacts(
  utterance: string,
  opts: { vehicleId: string; source: MemoryFact["source"] },
): FactUpsert[] {
  const out: FactUpsert[] = [];
  const vin = utterance.match(/\b([A-HJ-NPR-Z0-9]{17})\b/u);
  if (vin?.[1]) {
    out.push({ vehicleId: opts.vehicleId, key: "vin", value: vin[1], source: opts.source });
  }
  const phone = utterance.match(/\+?\d[\d\s-]{8,}\d/u);
  if (phone) {
    out.push({ vehicleId: opts.vehicleId, key: "contactPhone", value: phone[0].replace(/\s|-/gu, ""), source: opts.source });
  }
  const morning = /\bmorning\b/iu.test(utterance);
  if (morning) {
    out.push({ vehicleId: opts.vehicleId, key: "preference.pickupWindow", value: "morning", source: opts.source });
  }
  return out;
}

/** Default in-process store. Sufficient for v0.1; dev and test rely on it. */
export class InMemoryStore implements MemoryStore {
  readonly #byVehicle = new Map<string, Map<string, MemoryFact>>();

  async upsert(u: FactUpsert): Promise<void> {
    const bucket = this.#byVehicle.get(u.vehicleId) ?? new Map<string, MemoryFact>();
    bucket.set(u.key, {
      key: u.key,
      value: u.value,
      source: u.source,
      at: new Date().toISOString(),
    });
    this.#byVehicle.set(u.vehicleId, bucket);
  }

  async byVehicle(vehicleId: string): Promise<MemoryFact[]> {
    const bucket = this.#byVehicle.get(vehicleId);
    if (!bucket) return [];
    return Array.from(bucket.values()).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  async get(vehicleId: string, key: string): Promise<MemoryFact | undefined> {
    return this.#byVehicle.get(vehicleId)?.get(key);
  }

  async forget(vehicleId: string): Promise<void> {
    this.#byVehicle.delete(vehicleId);
  }
}

/** Convenience wrapper combining extraction + upsert. */
export async function rememberFromUtterance(
  store: MemoryStore,
  utterance: string,
  opts: { vehicleId: string; source: MemoryFact["source"] },
): Promise<number> {
  const facts = extractFacts(utterance, opts);
  for (const f of facts) await store.upsert(f);
  return facts.length;
}

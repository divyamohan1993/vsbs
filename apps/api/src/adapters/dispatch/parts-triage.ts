// =============================================================================
// Parts-aware dispatch triage.
//
// Author: Divya Mohan / dmj.one
// SPDX-License-Identifier: Apache-2.0
//
// Filters service-centre candidates to those that can fulfil a parts list,
// then re-orders by a composite score that reflects the dispatch research
// in docs/research/dispatch.md (wellbeing first, ETA penalty, parts score).
//
// The parts score is bounded in [0, 1]: 1 means every part is in stock with
// zero retrieval ETA, 0 means missing or > 60 min retrieval. It composes
// linearly with wellbeing and an ETA penalty so each component remains
// auditable in the rationale string.
// =============================================================================

import type { PartCode, PartsInventoryAdapterLike, AvailabilityResult } from "../parts/inventory.js";

export interface TriageCandidate {
  scId: string;
  /** Wellbeing score in [0, 1] from docs/research/wellbeing.md. */
  wellbeing: number;
  /** Estimated drive ETA from origin to SC, in minutes. */
  driveEtaMinutes: number;
}

export interface TriageResult {
  scId: string;
  wellbeing: number;
  driveEtaMinutes: number;
  partsScore: number;
  composite: number;
  availability: AvailabilityResult;
  rationale: string[];
}

const W_WELLBEING = 0.55;
const W_PARTS = 0.3;
const W_ETA_PENALTY = 0.15;
const ETA_FLOOR_MIN = 5;
const ETA_CEIL_MIN = 60;
const PART_ETA_FLOOR_MIN = 0;
const PART_ETA_CEIL_MIN = 60;

function clamp01(v: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function partsAvailabilityScore(a: AvailabilityResult): number {
  if (!a.available) return 0;
  const norm = (a.worstEtaMinutes - PART_ETA_FLOOR_MIN) / (PART_ETA_CEIL_MIN - PART_ETA_FLOOR_MIN);
  return clamp01(1 - norm);
}

function etaPenaltyScore(min: number): number {
  const norm = (min - ETA_FLOOR_MIN) / (ETA_CEIL_MIN - ETA_FLOOR_MIN);
  return clamp01(1 - norm);
}

/**
 * Rank candidate service centres for a request that needs `requiredParts`.
 * Returns the candidates that actually have everything in stock, sorted
 * descending by composite score. O(n * k) where n=candidates, k=parts list
 * length. n is bounded (< 50 in practice) and k is small (typically 1-4).
 */
export function triageByParts(
  inventory: PartsInventoryAdapterLike,
  candidates: TriageCandidate[],
  requiredParts: PartCode[],
): TriageResult[] {
  const enriched: TriageResult[] = [];
  for (const c of candidates) {
    const availability = inventory.available(c.scId, requiredParts);
    if (!availability.available) continue;
    const partsScore = partsAvailabilityScore(availability);
    const etaScore = etaPenaltyScore(c.driveEtaMinutes);
    const wellbeing = clamp01(c.wellbeing);
    const composite = W_WELLBEING * wellbeing + W_PARTS * partsScore + W_ETA_PENALTY * etaScore;
    const rationale: string[] = [
      `Wellbeing ${wellbeing.toFixed(2)} (weight ${W_WELLBEING.toFixed(2)})`,
      `Parts in stock — ${availability.lines.length}/${requiredParts.length} lines, retrieval up to ${availability.worstEtaMinutes} min (weight ${W_PARTS.toFixed(2)})`,
      `Drive ETA ${c.driveEtaMinutes} min (weight ${W_ETA_PENALTY.toFixed(2)})`,
    ];
    enriched.push({
      scId: c.scId,
      wellbeing,
      driveEtaMinutes: c.driveEtaMinutes,
      partsScore,
      composite,
      availability,
      rationale,
    });
  }
  enriched.sort((a, b) => b.composite - a.composite);
  return enriched;
}

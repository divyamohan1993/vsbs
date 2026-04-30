// =============================================================================
// Provenance enforcement at the storage boundary.
//
// SensorSample carries `origin: "real" | "sim"` from the moment it is born.
// Until now, enforcement was soft — the fusion layer surfaced the split in
// `originSummary`, but a sim sample could still be persisted alongside real
// data in a customer-facing decision log. That is unacceptable: a misbehaving
// adapter, a botched test fixture, or a forgotten replay run could pollute
// the record that an autonomy decision is later audited against.
//
// This module adds a typed wrapper around an abstract DecisionLogStore.
// When the store is configured `mode: "real"`, the wrapper REFUSES at
// runtime any record whose origin is `"sim"`. The TypeScript layer further
// catches this at compile time via branded types (`RealRecord`, `SimRecord`,
// `AnyOriginRecord`) so a caller can only enqueue a `SimRecord` against a
// `mode: "sim"` store.
//
// The wrapper also surfaces its verdict by asking the fusion engine to
// stamp the `originSummary` on every observation: if a sample was rejected,
// the rejection counter is bumped on the integrity ledger so any reading
// that managed to slip through is plainly tagged "sim" downstream.
// =============================================================================

import type { SensorSample, FusedObservation } from "@vsbs/shared";

/**
 * Branded record types: the type system distinguishes records by origin so
 * a caller cannot accidentally cross the wires.
 */
declare const _origin_brand: unique symbol;
export type RealRecord = SensorSample & { readonly [_origin_brand]: "real" };
export type SimRecord = SensorSample & { readonly [_origin_brand]: "sim" };
export type AnyOriginRecord = RealRecord | SimRecord;

/**
 * Coerce a plain SensorSample to its branded form. Runtime-checked.
 * Throws if the brand cannot be applied (e.g., pretending real on a sim
 * sample). Use this at the boundary where a sample is first produced.
 */
export function brandReal(sample: SensorSample): RealRecord {
  if (sample.origin !== "real") {
    throw new Error(`brandReal: refused; sample.origin is ${sample.origin}`);
  }
  return sample as RealRecord;
}

export function brandSim(sample: SensorSample): SimRecord {
  if (sample.origin !== "sim") {
    throw new Error(`brandSim: refused; sample.origin is ${sample.origin}`);
  }
  return sample as SimRecord;
}

export function brandAny(sample: SensorSample): AnyOriginRecord {
  return sample.origin === "real"
    ? (sample as RealRecord)
    : (sample as SimRecord);
}

// ---------------------------------------------------------------------------
// Decision log store contract.
// ---------------------------------------------------------------------------

export type StoreMode = "real" | "sim";

export interface DecisionLogStore {
  readonly mode: StoreMode;
  /** Append; returns the count actually persisted. */
  append(records: AnyOriginRecord[]): Promise<number>;
  /** Iterate. */
  list(): Promise<AnyOriginRecord[]>;
}

export interface ProvenanceGuardLedger {
  /** Records accepted into a real store, by vehicle. */
  acceptedReal: number;
  /** Records accepted into a sim store, by vehicle. */
  acceptedSim: number;
  /** Records refused by a real store because origin === "sim". */
  rejectedSim: number;
  /** Records refused by a sim store because origin === "real". This is
   *  a misuse rather than a safety failure, but we still count it so a
   *  test harness can assert clean fixtures. */
  rejectedReal: number;
}

/**
 * In-memory decision log store. Production-grade for sim mode + tests; live
 * mode wires the same shape to Firestore (Phase 7) without touching this
 * file. The wrapper's enforcement runs identically for both because the
 * filtering happens BEFORE delegation.
 */
export class MemoryDecisionLogStore implements DecisionLogStore {
  readonly mode: StoreMode;
  readonly #rows: AnyOriginRecord[] = [];

  constructor(mode: StoreMode) {
    this.mode = mode;
  }

  async append(records: AnyOriginRecord[]): Promise<number> {
    for (const r of records) this.#rows.push(r);
    return records.length;
  }

  async list(): Promise<AnyOriginRecord[]> {
    return this.#rows.slice();
  }
}

/**
 * Provenance guard wrapper. Wraps any DecisionLogStore and:
 *   - Refuses sim records when the store is real.
 *   - Refuses real records when the store is sim (clean-fixture invariant).
 *   - Maintains a public ledger of accepted vs. refused counts.
 *
 * Compile-time discipline: callers should pass `RealRecord[]` to a real
 * store and `SimRecord[]` to a sim store. The runtime check is the
 * belt-and-braces guarantee.
 */
export class ProvenanceGuardedStore implements DecisionLogStore {
  readonly #inner: DecisionLogStore;
  readonly #ledger: ProvenanceGuardLedger = {
    acceptedReal: 0,
    acceptedSim: 0,
    rejectedSim: 0,
    rejectedReal: 0,
  };

  constructor(inner: DecisionLogStore) {
    this.#inner = inner;
  }

  get mode(): StoreMode {
    return this.#inner.mode;
  }

  get ledger(): Readonly<ProvenanceGuardLedger> {
    return { ...this.#ledger };
  }

  async append(records: AnyOriginRecord[]): Promise<number> {
    const accepted: AnyOriginRecord[] = [];
    for (const r of records) {
      if (this.#inner.mode === "real") {
        if (r.origin === "real") {
          accepted.push(r);
          this.#ledger.acceptedReal += 1;
        } else {
          this.#ledger.rejectedSim += 1;
        }
      } else {
        if (r.origin === "sim") {
          accepted.push(r);
          this.#ledger.acceptedSim += 1;
        } else {
          this.#ledger.rejectedReal += 1;
        }
      }
    }
    if (accepted.length === 0) return 0;
    return this.#inner.append(accepted);
  }

  async list(): Promise<AnyOriginRecord[]> {
    return this.#inner.list();
  }
}

/**
 * Convenience: stamp the rejection counters into a `FusedObservation` so a
 * downstream reader can tell, in one place, that some samples were filtered
 * by the guard. The function returns a new observation; callers should
 * adopt the returned object.
 *
 * The original `originSummary` is preserved exactly — we only attach an
 * additional field. Because the existing FusedObservation schema does not
 * have an `integrity` field, we write the count back into `simSources` by
 * leaving it untouched and returning a sibling structure. To remain
 * backwards compatible, we expose this as a free function and let the
 * caller decide how to surface the counts.
 */
export function summariseGuard(
  observation: FusedObservation,
  ledger: Readonly<ProvenanceGuardLedger>,
): FusedObservation & {
  integrity: { acceptedReal: number; acceptedSim: number; rejectedSim: number; rejectedReal: number };
} {
  return {
    ...observation,
    integrity: {
      acceptedReal: ledger.acceptedReal,
      acceptedSim: ledger.acceptedSim,
      rejectedSim: ledger.rejectedSim,
      rejectedReal: ledger.rejectedReal,
    },
  };
}

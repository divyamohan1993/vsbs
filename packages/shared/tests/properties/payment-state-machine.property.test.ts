// =============================================================================
// Payment state machine — invariants under random event sequences.
// Reference: packages/shared/src/payment.ts.
// =============================================================================

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  PAYMENT_TRANSITIONS,
  canTransition,
  type PaymentState,
} from "../../src/payment.js";

const ALL_STATES = Object.keys(PAYMENT_TRANSITIONS) as PaymentState[];
const TERMINAL_STATES = ALL_STATES.filter(
  (s) => PAYMENT_TRANSITIONS[s].length === 0,
);

const arbState = fc.constantFrom(...ALL_STATES);

describe("Payment state machine — properties", () => {
  it("canTransition agrees with PAYMENT_TRANSITIONS for every (from, to)", () => {
    fc.assert(
      fc.property(arbState, arbState, (from, to) => {
        const allowed = PAYMENT_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(allowed);
      }),
      { numRuns: 500 },
    );
  });

  it("a random walk over allowed transitions never enters an undefined state", () => {
    fc.assert(
      fc.property(
        arbState,
        fc.array(fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 30,
        }),
        (start, picks) => {
          let s: PaymentState = start;
          for (const r of picks) {
            const allowed = PAYMENT_TRANSITIONS[s];
            if (allowed.length === 0) break;
            const next = allowed[Math.floor(r * allowed.length)]!;
            expect(canTransition(s, next)).toBe(true);
            s = next;
          }
          expect(ALL_STATES).toContain(s);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("terminal states are dead-ends — no outgoing edges", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERMINAL_STATES), arbState, (from, to) => {
        expect(canTransition(from, to)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("from any state, attempting a non-allowed event is rejected", () => {
    fc.assert(
      fc.property(arbState, arbState, (from, to) => {
        const allowed = PAYMENT_TRANSITIONS[from];
        if (allowed.includes(to)) return; // skip allowed pairs
        expect(canTransition(from, to)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("happy path order-created → settled is reachable in exactly 5 hops", () => {
    const path: PaymentState[] = [
      "order-created",
      "intent-created",
      "awaiting-customer",
      "authorised",
      "captured",
      "settled",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("settled and captured can both initiate a refund-pending", () => {
    expect(canTransition("captured", "refund-pending")).toBe(true);
    expect(canTransition("settled", "refund-pending")).toBe(true);
  });

  it("authorised cannot skip directly to settled (must go through captured)", () => {
    expect(canTransition("authorised", "settled")).toBe(false);
  });

  it("no transition allows arriving back at order-created from any state", () => {
    fc.assert(
      fc.property(arbState, (s) => {
        if (s === "order-created") return;
        expect(canTransition(s, "order-created")).toBe(false);
      }),
      { numRuns: 50 },
    );
  });
});

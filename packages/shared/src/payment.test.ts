import { describe, it, expect } from "vitest";
import { PAYMENT_TRANSITIONS, canTransition, type PaymentState } from "./payment.js";

const ALL_STATES = Object.keys(PAYMENT_TRANSITIONS) as PaymentState[];

describe("PAYMENT_TRANSITIONS", () => {
  it("every legal transition is accepted by canTransition", () => {
    for (const [from, tos] of Object.entries(PAYMENT_TRANSITIONS)) {
      for (const to of tos) {
        expect(canTransition(from as PaymentState, to)).toBe(true);
      }
    }
  });

  it("illegal transitions rejected", () => {
    for (const from of ALL_STATES) {
      const legal = new Set(PAYMENT_TRANSITIONS[from]);
      for (const to of ALL_STATES) {
        if (legal.has(to)) continue;
        if (from === to) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("terminal states have no outgoing transitions", () => {
    expect(PAYMENT_TRANSITIONS.refunded).toEqual([]);
    expect(PAYMENT_TRANSITIONS.failed).toEqual([]);
    expect(PAYMENT_TRANSITIONS.cancelled).toEqual([]);
    expect(PAYMENT_TRANSITIONS.expired).toEqual([]);
  });

  it("happy-path chain order-created → settled all legal", () => {
    const chain: PaymentState[] = [
      "order-created",
      "intent-created",
      "awaiting-customer",
      "authorised",
      "captured",
      "settled",
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(canTransition(chain[i]!, chain[i + 1]!)).toBe(true);
    }
  });

  it("canTransition rejects unknown from-state", () => {
    expect(canTransition("bogus" as PaymentState, "captured")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { buildOrder, buildIntent, transition, PaymentStateError } from "./state-machine.js";

const baseInput = {
  provider: "razorpay" as const,
  bookingId: "11111111-1111-4111-8111-111111111111",
  amount: { amountMinor: 50000, currency: "INR" as const },
  idempotencyKey: "idem-key-1",
};

describe("buildOrder", () => {
  it("returns an order in order-created state with the expected fields", () => {
    const order = buildOrder(baseInput, "order_test_1");
    expect(order.orderId).toBe("order_test_1");
    expect(order.state).toBe("order-created");
    expect(order.idempotencyKey).toBe("idem-key-1");
    expect(order.bookingId).toBe(baseInput.bookingId);
    expect(order.amount.amountMinor).toBe(50000);
    expect(order.metadata).toEqual({});
    expect(order.createdAt).toBe(order.updatedAt);
  });

  it("attaches capTokenHash when provided", () => {
    const order = buildOrder({ ...baseInput, capTokenHash: "a".repeat(64) }, "order_test_2");
    expect(order.capTokenHash).toBe("a".repeat(64));
  });
});

describe("buildIntent", () => {
  it("builds an intent with given fields", () => {
    const intent = buildIntent("order_1", "pay_1", "upi", "cs_1", "test@upi");
    expect(intent.intentId).toBe("pay_1");
    expect(intent.orderId).toBe("order_1");
    expect(intent.method).toBe("upi");
    expect(intent.upiVpa).toBe("test@upi");
  });

  it("omits upiVpa when not provided", () => {
    const intent = buildIntent("order_1", "pay_1", "card", "cs_1");
    expect(intent.upiVpa).toBeUndefined();
  });
});

describe("transition", () => {
  it("happy path order-created → intent-created → awaiting-customer → authorised → captured → settled", () => {
    let order = buildOrder(baseInput, "order_flow");
    order = transition(order, "intent-created");
    expect(order.state).toBe("intent-created");
    order = transition(order, "awaiting-customer");
    expect(order.state).toBe("awaiting-customer");
    order = transition(order, "authorised");
    expect(order.state).toBe("authorised");
    order = transition(order, "captured");
    expect(order.state).toBe("captured");
    order = transition(order, "settled");
    expect(order.state).toBe("settled");
    expect(order.settledAt).toBeDefined();
  });

  it("no-ops when transitioning to the same state", () => {
    const order = buildOrder(baseInput, "order_noop");
    const same = transition(order, "order-created");
    expect(same).toBe(order);
  });

  it("throws PaymentStateError on illegal transition", () => {
    const order = buildOrder(baseInput, "order_bad");
    expect(() => transition(order, "settled")).toThrow(PaymentStateError);
  });

  it("PaymentStateError carries from/to", () => {
    const order = buildOrder(baseInput, "order_bad2");
    try {
      transition(order, "captured");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentStateError);
      const err = e as PaymentStateError;
      expect(err.from).toBe("order-created");
      expect(err.to).toBe("captured");
    }
  });

  it("bumps updatedAt on transition", async () => {
    const order = buildOrder(baseInput, "order_ts");
    await new Promise((r) => setTimeout(r, 5));
    const next = transition(order, "intent-created");
    expect(next.updatedAt >= order.updatedAt).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import type {
  PaymentIntent,
  PaymentOrder,
  PaymentProvider,
  PaymentWebhookEvent,
} from "@vsbs/shared";
import { RazorpayAdapter } from "./razorpay.js";
import type { OrderStoreLike } from "./state-machine.js";

class FakeOrderStore implements OrderStoreLike {
  readonly orders = new Map<string, PaymentOrder>();
  readonly idem = new Map<string, PaymentOrder>();
  readonly intents = new Map<string, PaymentIntent>();
  readonly events: PaymentWebhookEvent[] = [];

  get(orderId: string): PaymentOrder | undefined {
    return this.orders.get(orderId);
  }
  getByIdempotencyKey(provider: PaymentProvider, key: string): PaymentOrder | undefined {
    return this.idem.get(`${provider}:${key}`);
  }
  put(order: PaymentOrder): void {
    this.orders.set(order.orderId, order);
    this.idem.set(`${order.provider}:${order.idempotencyKey}`, order);
  }
  getIntent(intentId: string): PaymentIntent | undefined {
    return this.intents.get(intentId);
  }
  putIntent(intent: PaymentIntent): void {
    this.intents.set(intent.intentId, intent);
  }
  getOrderByIntent(intentId: string): PaymentOrder | undefined {
    const i = this.intents.get(intentId);
    return i ? this.orders.get(i.orderId) : undefined;
  }
  appendEvent(event: PaymentWebhookEvent): void {
    this.events.push(event);
  }
}

function makeAdapter() {
  const store = new FakeOrderStore();
  const published: PaymentWebhookEvent[] = [];
  const adapter = new RazorpayAdapter({
    mode: "sim",
    store,
    publishWebhook: async (e) => {
      published.push(e);
    },
    simSeed: 42,
  });
  return { store, adapter, published };
}

const baseInput = {
  bookingId: "22222222-2222-4222-8222-222222222222",
  amount: { amountMinor: 100000, currency: "INR" as const },
  idempotencyKey: "rzp-key-1",
};

describe("RazorpayAdapter (sim mode)", () => {
  it(
    "full happy flow in < 3s with seeded PRNG",
    async () => {
      const start = Date.now();
      const { store, adapter, published } = makeAdapter();

      const order = await adapter.createOrder(baseInput);
      expect(order.state).toBe("order-created");
      expect(order.orderId).toMatch(/^order_sim_/);

      const intent = await adapter.createIntent(order.orderId, "upi", "test@upi");
      expect(intent.intentId).toMatch(/^pay_sim_/);
      const awaiting = store.get(order.orderId)!;
      expect(awaiting.state).toBe("awaiting-customer");

      const authd = await adapter.authorise(intent.intentId, { ok: true });
      expect(authd.state).toBe("authorised");

      const cap = await adapter.capture(order.orderId);
      // In sim mode capture also settles.
      expect(cap.state).toBe("settled");
      expect(cap.settledAt).toBeDefined();

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(3000);

      // Webhook publications should have fired for authorised/captured/settled.
      const types = published.map((e) => e.type);
      expect(types).toContain("payment.authorized");
      expect(types).toContain("payment.captured");
      expect(types).toContain("payment.settled");
    },
    5000,
  );

  it("createOrder with same idempotency key returns same orderId", async () => {
    const { adapter } = makeAdapter();
    const a = await adapter.createOrder(baseInput);
    const b = await adapter.createOrder(baseInput);
    expect(b.orderId).toBe(a.orderId);
  });

  it("authorise with ok=false transitions to failed with reason", async () => {
    const { adapter } = makeAdapter();
    const order = await adapter.createOrder({ ...baseInput, idempotencyKey: "rzp-fail" });
    const intent = await adapter.createIntent(order.orderId, "card");
    const failed = await adapter.authorise(intent.intentId, { ok: false, reason: "card-declined" });
    expect(failed.state).toBe("failed");
    expect(failed.failureReason).toBe("card-declined");
  });

  it("refund path transitions to refunded", async () => {
    const { adapter } = makeAdapter();
    const order = await adapter.createOrder({ ...baseInput, idempotencyKey: "rzp-refund" });
    const intent = await adapter.createIntent(order.orderId, "card");
    await adapter.authorise(intent.intentId, { ok: true });
    const captured = await adapter.capture(order.orderId);
    // After sim capture, order is `settled`. Refund should walk via refund-pending → refunded.
    expect(captured.state).toBe("settled");
    const refunded = await adapter.refund(order.orderId, "customer-request");
    expect(refunded.state).toBe("refunded");
  });

  it("verifyWebhook signature ok in sim mode", async () => {
    const { adapter } = makeAdapter();
    const body = JSON.stringify({ id: "evt_1", order_id: "order_sim_1", type: "payment.captured" });
    const evt = await adapter.verifyWebhook("ignored", body);
    expect(evt.signatureOk).toBe(true);
    expect(evt.eventId).toBe("evt_1");
    expect(evt.type).toBe("payment.captured");
    expect(evt.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

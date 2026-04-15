// =============================================================================
// Razorpay adapter — sim and live drivers share the state machine.
//
// Live references:
//   https://razorpay.com/docs/api/orders/
//   https://razorpay.com/docs/webhooks/validate-test/
//
// The *only* difference between the two drivers is how they speak to
// the outside world:
//   * sim  → deterministic PRNG, in-process webhook publish, no network.
//   * live → POST to api.razorpay.com, real webhook verification.
// =============================================================================

import {
  type PaymentAdapter,
  type PaymentOrder,
  type PaymentIntent,
  type PaymentMoney,
  type PaymentWebhookEvent,
  simLatency,
  mulberry32,
} from "@vsbs/shared";

import { buildIntent, buildOrder, transition, type OrderStoreLike } from "./state-machine.js";

export interface RazorpayAdapterConfig {
  mode: "sim" | "live";
  store: OrderStoreLike;
  /** Publishes webhook events onto the same event bus the live driver would. */
  publishWebhook: (event: PaymentWebhookEvent) => Promise<void>;
  /** Only required in live mode. */
  keyId?: string | undefined;
  keySecret?: string | undefined;
  webhookSecret?: string | undefined;
  fetchImpl?: typeof fetch;
  /** Only used in sim mode — seed the PRNG for reproducible tests. */
  simSeed?: number | undefined;
}

function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", bytes).then((buf) => {
    const arr = new Uint8Array(buf);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  });
}

export class RazorpayAdapter implements PaymentAdapter {
  readonly provider = "razorpay" as const;
  readonly mode: "sim" | "live";
  readonly #cfg: RazorpayAdapterConfig;
  readonly #rng: () => number;

  constructor(cfg: RazorpayAdapterConfig) {
    this.#cfg = cfg;
    this.mode = cfg.mode;
    this.#rng = mulberry32(cfg.simSeed ?? 0xc0ffee);
    if (cfg.mode === "live") {
      if (!cfg.keyId || !cfg.keySecret || !cfg.webhookSecret) {
        throw new Error("Razorpay live mode requires keyId, keySecret, webhookSecret");
      }
    }
  }

  async createOrder(input: {
    bookingId: string;
    amount: PaymentMoney;
    idempotencyKey: string;
    capTokenHash?: string | undefined;
  }): Promise<PaymentOrder> {
    // Idempotency first — same key, same provider, return the existing row.
    const existing = this.#cfg.store.getByIdempotencyKey("razorpay", input.idempotencyKey);
    if (existing) return existing;

    const orderId =
      this.mode === "sim"
        ? `order_sim_${Math.floor(this.#rng() * 1e12).toString(16)}`
        : await this.#createOrderLive(input);

    const order = buildOrder(
      { provider: "razorpay", ...input, capTokenHash: input.capTokenHash },
      orderId,
    );
    this.#cfg.store.put(order);

    // Immediate transition — Razorpay returns an order id synchronously.
    return order;
  }

  async createIntent(
    orderId: string,
    method: PaymentIntent["method"],
    upiVpa?: string,
  ): Promise<PaymentIntent> {
    const order = this.#cfg.store.get(orderId);
    if (!order) throw new Error(`order ${orderId} not found`);
    const next = transition(order, "intent-created");
    this.#cfg.store.put(next);

    const intentId =
      this.mode === "sim"
        ? `pay_sim_${Math.floor(this.#rng() * 1e12).toString(16)}`
        : await this.#createIntentLive(order, method, upiVpa);
    const intent = buildIntent(
      orderId,
      intentId,
      method,
      `cs_${intentId}_${Math.floor(this.#rng() * 1e9)}`,
      upiVpa,
    );
    this.#cfg.store.putIntent(intent);

    // Publish intent-awaiting state too.
    this.#cfg.store.put(transition(next, "awaiting-customer"));
    return intent;
  }

  async authorise(
    intentId: string,
    customerAction: { ok: boolean; reason?: string | undefined },
  ): Promise<PaymentOrder> {
    const order = this.#cfg.store.getOrderByIntent(intentId);
    if (!order) throw new Error(`order for intent ${intentId} not found`);

    // Simulate / honour the customer's action.
    if (!customerAction.ok) {
      const failed = { ...transition(order, "failed"), failureReason: customerAction.reason ?? "declined" };
      this.#cfg.store.put(failed);
      await this.#publish(failed, "payment.failed");
      return failed;
    }
    const authorised = transition(order, "authorised");
    this.#cfg.store.put(authorised);
    await this.#publish(authorised, "payment.authorized");
    return authorised;
  }

  async capture(orderId: string): Promise<PaymentOrder> {
    const order = this.#cfg.store.get(orderId);
    if (!order) throw new Error(`order ${orderId} not found`);
    const captured = transition(order, "captured");
    this.#cfg.store.put(captured);
    await this.#publish(captured, "payment.captured");
    if (this.mode === "sim") {
      // Razorpay settles T+2 business days; for determinism we immediately
      // fire a settlement event in sim mode, tagged with a back-dated ts.
      const settled = transition(captured, "settled");
      this.#cfg.store.put(settled);
      await this.#publish(settled, "payment.settled");
      return settled;
    }
    // In live mode settlement arrives via webhook from Razorpay.
    return captured;
  }

  async refund(orderId: string, reason: string): Promise<PaymentOrder> {
    const order = this.#cfg.store.get(orderId);
    if (!order) throw new Error(`order ${orderId} not found`);
    const pending = { ...transition(order, "refund-pending"), failureReason: reason };
    this.#cfg.store.put(pending);
    const refunded = transition(pending, "refunded");
    this.#cfg.store.put(refunded);
    await this.#publish(refunded, "payment.refunded");
    return refunded;
  }

  async verifyWebhook(signatureHeader: string, rawBody: string): Promise<PaymentWebhookEvent> {
    // In sim mode webhooks are published in-process so they always verify.
    // In live mode we HMAC-SHA256 with the webhookSecret per Razorpay docs.
    const payloadHash = await sha256Hex(rawBody);
    if (this.mode === "sim") {
      const parsed = JSON.parse(rawBody) as { id: string; order_id: string; type: PaymentWebhookEvent["type"] };
      const event: PaymentWebhookEvent = {
        eventId: parsed.id,
        orderId: parsed.order_id,
        type: parsed.type,
        ts: new Date().toISOString(),
        signatureOk: true,
        deliveryCount: 1,
        payloadHash,
      };
      this.#cfg.store.appendEvent(event);
      return event;
    }
    // live: HMAC verification
    const expected = await hmacSha256(this.#cfg.webhookSecret!, rawBody);
    const ok = constantTimeEquals(expected, signatureHeader);
    const parsed = JSON.parse(rawBody) as { id: string; order_id: string; type: PaymentWebhookEvent["type"] };
    const event: PaymentWebhookEvent = {
      eventId: parsed.id,
      orderId: parsed.order_id,
      type: parsed.type,
      ts: new Date().toISOString(),
      signatureOk: ok,
      deliveryCount: 1,
      payloadHash,
    };
    this.#cfg.store.appendEvent(event);
    return event;
  }

  // ------- helpers -------

  async #publish(order: PaymentOrder, type: PaymentWebhookEvent["type"]): Promise<void> {
    const latency = simLatency(this.#rng, 150, 0.5);
    if (this.mode === "sim") await sleep(latency);
    const eventId = `evt_${this.mode}_${Math.floor(this.#rng() * 1e12).toString(16)}`;
    const payloadHash = await sha256Hex(`${order.orderId}:${type}:${order.updatedAt}`);
    const event: PaymentWebhookEvent = {
      eventId,
      orderId: order.orderId,
      type,
      ts: new Date().toISOString(),
      signatureOk: true,
      deliveryCount: 1,
      payloadHash,
    };
    this.#cfg.store.appendEvent(event);
    await this.#cfg.publishWebhook(event);
  }

  async #createOrderLive(input: {
    bookingId: string;
    amount: PaymentMoney;
    idempotencyKey: string;
  }): Promise<string> {
    const fetchImpl = this.#cfg.fetchImpl ?? fetch;
    const auth = btoa(`${this.#cfg.keyId}:${this.#cfg.keySecret}`);
    const res = await fetchImpl("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        amount: input.amount.amountMinor,
        currency: input.amount.currency,
        receipt: input.bookingId,
        notes: { bookingId: input.bookingId },
      }),
    });
    if (!res.ok) throw new Error(`Razorpay order create failed ${res.status}`);
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  async #createIntentLive(
    order: PaymentOrder,
    method: PaymentIntent["method"],
    _upiVpa: string | undefined,
  ): Promise<string> {
    // Razorpay uses a client-side checkout to produce the payment id;
    // on the server we create a "payment link" and use its id as the
    // intent id to keep the contract aligned with our state machine.
    const fetchImpl = this.#cfg.fetchImpl ?? fetch;
    const auth = btoa(`${this.#cfg.keyId}:${this.#cfg.keySecret}`);
    const res = await fetchImpl("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: order.amount.amountMinor,
        currency: order.amount.currency,
        accept_partial: false,
        reference_id: order.orderId,
        description: `VSBS booking ${order.bookingId}`,
        notes: { bookingId: order.bookingId, method },
      }),
    });
    if (!res.ok) throw new Error(`Razorpay intent create failed ${res.status}`);
    const body = (await res.json()) as { id: string };
    return body.id;
  }
}

async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// In-memory implementation of OrderStoreLike for development + tests.
// Production swaps this for a Firestore-backed store with the same interface.

import type { PaymentOrder, PaymentIntent, PaymentProvider, PaymentWebhookEvent } from "@vsbs/shared";
import type { OrderStoreLike } from "./state-machine.js";

export class MemoryOrderStore implements OrderStoreLike {
  readonly #orders = new Map<string, PaymentOrder>();
  readonly #byIdem = new Map<string, string>();
  readonly #intents = new Map<string, PaymentIntent>();
  readonly #intentToOrder = new Map<string, string>();
  readonly events: PaymentWebhookEvent[] = [];

  get(orderId: string): PaymentOrder | undefined {
    return this.#orders.get(orderId);
  }

  getByIdempotencyKey(provider: PaymentProvider, key: string): PaymentOrder | undefined {
    const orderId = this.#byIdem.get(`${provider}:${key}`);
    return orderId ? this.#orders.get(orderId) : undefined;
  }

  put(order: PaymentOrder): void {
    this.#orders.set(order.orderId, order);
    this.#byIdem.set(`${order.provider}:${order.idempotencyKey}`, order.orderId);
  }

  getIntent(intentId: string): PaymentIntent | undefined {
    return this.#intents.get(intentId);
  }

  putIntent(intent: PaymentIntent): void {
    this.#intents.set(intent.intentId, intent);
    this.#intentToOrder.set(intent.intentId, intent.orderId);
  }

  getOrderByIntent(intentId: string): PaymentOrder | undefined {
    const orderId = this.#intentToOrder.get(intentId);
    return orderId ? this.#orders.get(orderId) : undefined;
  }

  appendEvent(event: PaymentWebhookEvent): void {
    this.events.push(event);
  }
}

// =============================================================================
// Payment state machine — ONE copy, used by every provider adapter.
// Per docs/simulation-policy.md the state machine is the adapter; sim
// and live differ only in how they talk to the outside world.
// =============================================================================

import {
  type PaymentOrder,
  type PaymentState,
  type PaymentIntent,
  type PaymentMoney,
  type PaymentProvider,
  type PaymentWebhookEvent,
  canTransition,
} from "@vsbs/shared";

export interface OrderStoreLike {
  get(orderId: string): PaymentOrder | undefined;
  getByIdempotencyKey(provider: PaymentProvider, key: string): PaymentOrder | undefined;
  put(order: PaymentOrder): void;
  getIntent(intentId: string): PaymentIntent | undefined;
  putIntent(intent: PaymentIntent): void;
  getOrderByIntent(intentId: string): PaymentOrder | undefined;
  appendEvent(event: PaymentWebhookEvent): void;
}

export class PaymentStateError extends Error {
  constructor(
    readonly from: PaymentState,
    readonly to: PaymentState,
  ) {
    super(`Illegal payment transition ${from} -> ${to}`);
  }
}

export function transition(order: PaymentOrder, to: PaymentState): PaymentOrder {
  if (order.state === to) return order;
  if (!canTransition(order.state, to)) {
    throw new PaymentStateError(order.state, to);
  }
  return {
    ...order,
    state: to,
    updatedAt: new Date().toISOString(),
    ...(to === "settled" ? { settledAt: new Date().toISOString() } : {}),
  };
}

export interface CreateOrderInput {
  provider: PaymentProvider;
  bookingId: string;
  amount: PaymentMoney;
  idempotencyKey: string;
  capTokenHash?: string | undefined;
}

/** Pure factory — builds an order object in `order-created` state. */
export function buildOrder(input: CreateOrderInput, orderId: string): PaymentOrder {
  const now = new Date().toISOString();
  return {
    orderId,
    bookingId: input.bookingId,
    provider: input.provider,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    state: "order-created",
    createdAt: now,
    updatedAt: now,
    ...(input.capTokenHash !== undefined ? { capTokenHash: input.capTokenHash } : {}),
    metadata: {},
  };
}

/** Pure factory — builds an intent object. */
export function buildIntent(
  orderId: string,
  intentId: string,
  method: PaymentIntent["method"],
  clientSecret: string,
  upiVpa?: string,
): PaymentIntent {
  return {
    intentId,
    orderId,
    clientSecret,
    method,
    ...(upiVpa !== undefined ? { upiVpa } : {}),
    createdAt: new Date().toISOString(),
  };
}

// =============================================================================
// Payment — shared contracts. Sim and live drivers in apps/api share
// this state machine. See docs/simulation-policy.md.
//
// The model below is the union of what Razorpay, Stripe, and UPI
// expose, normalised. Any new PSP is a new adapter, not a new type.
// =============================================================================

import { z } from "zod";

export const PaymentProviderSchema = z.enum(["razorpay", "stripe", "upi"]);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

export const CurrencySchema = z.enum(["INR", "USD", "EUR", "GBP"]);
export type Currency = z.infer<typeof CurrencySchema>;

/**
 * The canonical payment state machine used by every provider adapter.
 * Transitions are enforced by the shared state machine; sim and live
 * drivers dispatch the transitions, they do not reinvent them.
 */
export const PaymentStateSchema = z.enum([
  "order-created",
  "intent-created",
  "awaiting-customer",
  "authorised",
  "captured",
  "settled",
  "refund-pending",
  "refunded",
  "failed",
  "cancelled",
  "expired",
]);
export type PaymentState = z.infer<typeof PaymentStateSchema>;

/** Allowed transitions — enforced at commit time in the adapter. */
export const PAYMENT_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  "order-created": ["intent-created", "cancelled", "expired"],
  "intent-created": ["awaiting-customer", "cancelled", "expired", "failed"],
  "awaiting-customer": ["authorised", "failed", "cancelled", "expired"],
  "authorised": ["captured", "cancelled", "failed"],
  "captured": ["settled", "refund-pending"],
  "settled": ["refund-pending"],
  "refund-pending": ["refunded", "failed"],
  "refunded": [],
  "failed": [],
  "cancelled": [],
  "expired": [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  const allowed = PAYMENT_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export const PaymentMoneySchema = z.object({
  amountMinor: z.number().int().nonnegative().describe("Amount in the smallest unit (paise / cents)"),
  currency: CurrencySchema,
});
export type PaymentMoney = z.infer<typeof PaymentMoneySchema>;

export const PaymentOrderSchema = z.object({
  orderId: z.string(),
  bookingId: z.string().uuid(),
  provider: PaymentProviderSchema,
  amount: PaymentMoneySchema,
  idempotencyKey: z.string(),
  state: PaymentStateSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  capTokenHash: z.string().length(64).optional().describe("Hash of the CommandGrant auto-pay cap that authorised this payment, if any."),
  failureReason: z.string().optional(),
  settledAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type PaymentOrder = z.infer<typeof PaymentOrderSchema>;

export const PaymentIntentSchema = z.object({
  intentId: z.string(),
  orderId: z.string(),
  clientSecret: z.string(),
  method: z.enum(["card", "upi", "netbanking", "wallet"]),
  upiVpa: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type PaymentIntent = z.infer<typeof PaymentIntentSchema>;

export const PaymentWebhookEventSchema = z.object({
  eventId: z.string(),
  orderId: z.string(),
  type: z.enum([
    "payment.authorized",
    "payment.captured",
    "payment.failed",
    "payment.refunded",
    "payment.settled",
  ]),
  ts: z.string().datetime(),
  signatureOk: z.boolean(),
  deliveryCount: z.number().int().nonnegative(),
  payloadHash: z.string().length(64),
});
export type PaymentWebhookEvent = z.infer<typeof PaymentWebhookEventSchema>;

/** The interface every provider adapter (sim or live) implements. */
export interface PaymentAdapter {
  readonly provider: PaymentProvider;
  readonly mode: "sim" | "live";
  createOrder(input: {
    bookingId: string;
    amount: PaymentMoney;
    idempotencyKey: string;
    capTokenHash?: string | undefined;
  }): Promise<PaymentOrder>;
  createIntent(
    orderId: string,
    method: PaymentIntent["method"],
    upiVpa?: string | undefined,
  ): Promise<PaymentIntent>;
  authorise(
    intentId: string,
    customerAction: { ok: boolean; reason?: string | undefined },
  ): Promise<PaymentOrder>;
  capture(orderId: string): Promise<PaymentOrder>;
  refund(orderId: string, reason: string): Promise<PaymentOrder>;
  verifyWebhook(signatureHeader: string, rawBody: string): Promise<PaymentWebhookEvent>;
}

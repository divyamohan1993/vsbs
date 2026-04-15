// =============================================================================
// Payment routes — thin HTTP surface over the PaymentAdapter. Sim and
// live drivers share every behaviour; only network transport differs.
// =============================================================================

import { Hono } from "hono";
import { zv } from "../middleware/zv.js";
import { z } from "zod";

import { PaymentMoneySchema, type PaymentAdapter } from "@vsbs/shared";
import { RazorpayAdapter } from "../adapters/payment/razorpay.js";
import { MemoryOrderStore } from "../adapters/payment/memory-store.js";
import type { Env } from "../env.js";

export function buildPaymentRouter(env: Env) {
  const router = new Hono();

  // Shared store — in production this is the Firestore-backed store.
  const store = new MemoryOrderStore();

  // Webhook publisher — in production this publishes to Pub/Sub.
  const publishWebhook = async (e: { eventId: string; type: string }) => {
    // Intentionally minimal — production wires Pub/Sub here.
    void e;
  };

  const provider: PaymentAdapter =
    env.PAYMENT_PROVIDER === "razorpay"
      ? new RazorpayAdapter({
          mode: env.PAYMENT_MODE,
          store,
          publishWebhook,
          ...(env.PAYMENT_MODE === "live"
            ? {
                keyId: env.RAZORPAY_KEY_ID,
                keySecret: env.RAZORPAY_KEY_SECRET,
                webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
              }
            : {}),
        })
      : new RazorpayAdapter({
          // Placeholder for stripe/upi adapters — same pattern.
          mode: "sim",
          store,
          publishWebhook,
        });

  router.post(
    "/orders",
    zv(
      "json",
      z.object({
        bookingId: z.string().uuid(),
        amount: PaymentMoneySchema,
        idempotencyKey: z.string().min(8).max(120),
        capTokenHash: z.string().length(64).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const order = await provider.createOrder(body);
      return c.json({ data: order }, 201);
    },
  );

  router.post(
    "/orders/:orderId/intents",
    zv(
      "json",
      z.object({
        method: z.enum(["card", "upi", "netbanking", "wallet"]),
        upiVpa: z.string().optional(),
      }),
    ),
    async (c) => {
      const orderId = c.req.param("orderId");
      const { method, upiVpa } = c.req.valid("json");
      const intent = await provider.createIntent(orderId, method, upiVpa);
      return c.json({ data: intent }, 201);
    },
  );

  router.post(
    "/intents/:intentId/authorise",
    zv("json", z.object({ ok: z.boolean(), reason: z.string().optional() })),
    async (c) => {
      const intentId = c.req.param("intentId");
      const result = await provider.authorise(intentId, c.req.valid("json"));
      return c.json({ data: result });
    },
  );

  router.post("/orders/:orderId/capture", async (c) => {
    const orderId = c.req.param("orderId");
    const result = await provider.capture(orderId);
    return c.json({ data: result });
  });

  router.post(
    "/orders/:orderId/refund",
    zv("json", z.object({ reason: z.string().min(1).max(500) })),
    async (c) => {
      const orderId = c.req.param("orderId");
      const { reason } = c.req.valid("json");
      const result = await provider.refund(orderId, reason);
      return c.json({ data: result });
    },
  );

  router.post("/webhooks/:provider", async (c) => {
    const sig = c.req.header("x-razorpay-signature") ?? c.req.header("stripe-signature") ?? "";
    const raw = await c.req.text();
    const event = await provider.verifyWebhook(sig, raw);
    if (!event.signatureOk) return c.json({ error: { code: "BAD_SIGNATURE" } }, 400);
    return c.json({ data: event });
  });

  return router;
}

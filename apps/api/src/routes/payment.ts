// =============================================================================
// Payment routes — thin HTTP surface over the PaymentAdapter. Sim and
// live drivers share every behaviour; only network transport differs.
//
// Every mutating route requires an authenticated session and verifies that
// the caller owns the booking the order was created for. Webhooks remain
// HMAC-only — ownership is implicit through the signed payload.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";

import { type PaymentAdapter, PaymentMoneySchema } from "@vsbs/shared";
import { MemoryOrderStore } from "../adapters/payment/memory-store.js";
import { RazorpayAdapter } from "../adapters/payment/razorpay.js";
import type { Env } from "../env.js";
import { errBody } from "../middleware/security.js";
import { type SessionAppEnv, requireSession } from "../middleware/session.js";
import { getBookingOwnerSubject } from "./bookings.js";

export interface BuildPaymentRouterOptions {
	/** HMAC signing key for the session bearer. Required. */
	signingKey: string;
}

export function buildPaymentRouter(env: Env, opts: BuildPaymentRouterOptions) {
	const router = new Hono<SessionAppEnv>();

	// Webhook routes use HMAC-only auth — they MUST be mounted before the
	// session gate so the webhook publisher does not need a bearer token.
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

	// Webhook routes — HMAC only, no session gate.
	router.post("/webhooks/:provider", async (c) => {
		const sig = c.req.header("x-razorpay-signature") ?? c.req.header("stripe-signature") ?? "";
		const raw = await c.req.text();
		const event = await provider.verifyWebhook(sig, raw);
		if (!event.signatureOk) return c.json({ error: { code: "BAD_SIGNATURE" } }, 400);
		return c.json({ data: event });
	});

	// Everything below requires an authenticated owner session.
	router.use("*", requireSession({ signingKey: opts.signingKey }));

	const errResponse = (
		c: Parameters<typeof errBody>[2],
		code: string,
		message: string,
		status: 403 | 404,
	): Response =>
		new Response(JSON.stringify(errBody(code, message, c)), {
			status,
			headers: { "content-type": "application/json" },
		});

	const ensureBookingOwner = (
		c: Parameters<typeof errBody>[2],
		bookingId: string,
		ownerSubject: string,
	): Response | null => {
		const owner = getBookingOwnerSubject(bookingId);
		if (!owner) return errResponse(c, "BOOKING_NOT_FOUND", "Booking not found", 404);
		if (owner !== ownerSubject) {
			return errResponse(c, "PAYMENT_FORBIDDEN", "Not your booking", 403);
		}
		return null;
	};

	const ensureOrderOwner = (
		c: Parameters<typeof errBody>[2],
		orderId: string,
		ownerSubject: string,
	): Response | null => {
		const order = store.get(orderId);
		if (!order) return errResponse(c, "ORDER_NOT_FOUND", "Order not found", 404);
		return ensureBookingOwner(c, order.bookingId, ownerSubject);
	};

	const ensureIntentOwner = (
		c: Parameters<typeof errBody>[2],
		intentId: string,
		ownerSubject: string,
	): Response | null => {
		const order = store.getOrderByIntent(intentId);
		if (!order) return errResponse(c, "INTENT_NOT_FOUND", "Intent not found", 404);
		return ensureBookingOwner(c, order.bookingId, ownerSubject);
	};

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
			const ownerSubject = c.get("ownerSubject");
			const blocked = ensureBookingOwner(
				c as unknown as Parameters<typeof errBody>[2],
				body.bookingId,
				ownerSubject,
			);
			if (blocked) return blocked;
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
			const blocked = ensureOrderOwner(
				c as unknown as Parameters<typeof errBody>[2],
				orderId,
				c.get("ownerSubject"),
			);
			if (blocked) return blocked;
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
			const blocked = ensureIntentOwner(
				c as unknown as Parameters<typeof errBody>[2],
				intentId,
				c.get("ownerSubject"),
			);
			if (blocked) return blocked;
			const result = await provider.authorise(intentId, c.req.valid("json"));
			return c.json({ data: result });
		},
	);

	router.post("/orders/:orderId/capture", async (c) => {
		const orderId = c.req.param("orderId");
		const blocked = ensureOrderOwner(
			c as unknown as Parameters<typeof errBody>[2],
			orderId,
			c.get("ownerSubject"),
		);
		if (blocked) return blocked;
		const result = await provider.capture(orderId);
		return c.json({ data: result });
	});

	router.post(
		"/orders/:orderId/refund",
		zv("json", z.object({ reason: z.string().min(1).max(500) })),
		async (c) => {
			const orderId = c.req.param("orderId");
			const blocked = ensureOrderOwner(
				c as unknown as Parameters<typeof errBody>[2],
				orderId,
				c.get("ownerSubject"),
			);
			if (blocked) return blocked;
			const { reason } = c.req.valid("json");
			const result = await provider.refund(orderId, reason);
			return c.json({ data: result });
		},
	);

	return router;
}

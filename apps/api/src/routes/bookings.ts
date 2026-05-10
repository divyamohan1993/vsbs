// =============================================================================
// /v1/bookings — owner-scoped CRUD + SSE timeline.
//
// Each booking carries the authenticated `ownerSubject` so that every
// subsequent action (payment create, autonomy grant, dispatch lookup) can
// verify the caller actually owns the booking.
//
// In production this would fan-out Pub/Sub events for a real booking. For
// v0.1 sim mode we emit a deterministic Maister-aligned status timeline
// so the UX can be exercised end-to-end.
// =============================================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { errBody } from "../middleware/security.js";
import { type SessionAppEnv, requireSession } from "../middleware/session.js";
import { zv } from "../middleware/zv.js";

/** One frame of the booking-status timeline. */
export interface BookingFrame {
	at: string;
	status: string;
	etaMinutes: number;
	wellbeing: number;
	explanation: string;
}

const BookingCreateSchema = z.object({
	owner: z.object({
		phone: z.string().min(1),
		subject: z.string().optional(),
	}),
	vehicle: z.object({
		vin: z.string().optional(),
		make: z.string().optional(),
		model: z.string().optional(),
		year: z.number().int().optional(),
	}),
	issue: z.object({
		symptoms: z.string().min(1),
		canDriveSafely: z.enum([
			"yes-confidently",
			"yes-cautiously",
			"unsure",
			"no",
			"already-stranded",
		]),
		redFlags: z.array(z.string()),
	}),
	safety: z.object({
		severity: z.enum(["red", "amber", "green"]),
		rationale: z.string().min(1),
		triggered: z.array(z.string()),
	}),
	source: z.enum(["web", "agent", "api"]).optional(),
});

type BookingCreate = z.infer<typeof BookingCreateSchema>;

interface Booking extends BookingCreate {
	id: string;
	ownerSubject: string;
	status: "accepted";
	createdAt: string;
	updatedAt: string;
	source: "web" | "agent" | "api";
}

// -----------------------------------------------------------------------------
// Process-wide booking store. Used by payment.ts and autonomy.ts to verify the
// caller actually owns the booking they reference. Production: Firestore.
// -----------------------------------------------------------------------------
const BOOKINGS = new Map<string, Booking>();

/** Look up the ownerSubject for a booking. Returns null if unknown. */
export function getBookingOwnerSubject(id: string): string | null {
	return BOOKINGS.get(id)?.ownerSubject ?? null;
}

/** Test seam: clear the in-memory store between vitest cases. */
export function __resetBookingsStoreForTest(): void {
	BOOKINGS.clear();
}

/** Default demo timeline — 5 frames spaced ~1s apart. */
function defaultTimeline(id: string): BookingFrame[] {
	const now = Date.now();
	const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
	return [
		{
			at: iso(0),
			status: "Assigned",
			etaMinutes: 22,
			wellbeing: 0.82,
			explanation: `Booking ${id}: technician Ravi is finishing a brake reseal on the previous car. 22 minutes to you.`,
		},
		{
			at: iso(1_000),
			status: "Vehicle pickup",
			etaMinutes: 18,
			wellbeing: 0.84,
			explanation: "Driver Priya is 1.2 km away. She will arrive in 3 minutes.",
		},
		{
			at: iso(2_000),
			status: "En route to service centre",
			etaMinutes: 12,
			wellbeing: 0.86,
			explanation:
				"On the Outer Ring Road. Light traffic. Wellbeing remains high — quote already locked.",
		},
		{
			at: iso(3_000),
			status: "At bay",
			etaMinutes: 6,
			wellbeing: 0.88,
			explanation: "Front brake pads inspected. Replacement confirmed within the quoted range.",
		},
		{
			at: iso(4_000),
			status: "Ready for handover",
			etaMinutes: 0,
			wellbeing: 0.9,
			explanation:
				"Service complete. Driver Priya is returning the vehicle now. Wellbeing score 0.90.",
		},
	];
}

export interface BuildBookingsRouterOptions {
	/** HMAC signing key for the session bearer. Required. */
	signingKey: string;
}

export function buildBookingsRouter(opts: BuildBookingsRouterOptions) {
	const router = new Hono<SessionAppEnv>();

	router.use("*", requireSession({ signingKey: opts.signingKey }));

	router.post("/", zv("json", BookingCreateSchema), (c) => {
		const body = c.req.valid("json");
		const ownerSubject = c.get("ownerSubject");
		const now = new Date().toISOString();
		const booking: Booking = {
			...body,
			id: crypto.randomUUID(),
			ownerSubject,
			status: "accepted",
			createdAt: now,
			updatedAt: now,
			source: body.source ?? "api",
		};
		BOOKINGS.set(booking.id, booking);

		return c.json({ data: booking }, 201);
	});

	router.get("/:id/stream", (c) => {
		const id = c.req.param("id");
		const booking = BOOKINGS.get(id);
		if (!booking) {
			return c.json(errBody("BOOKING_NOT_FOUND", "Booking not found", c), 404);
		}
		if (booking.ownerSubject !== c.get("ownerSubject")) {
			return c.json(errBody("BOOKING_FORBIDDEN", "Not your booking", c), 403);
		}
		return streamSSE(c, async (stream) => {
			for (const frame of defaultTimeline(id)) {
				await stream.writeSSE({
					event: "frame",
					data: JSON.stringify(frame),
				});
				await stream.sleep(1_000);
			}
			await stream.writeSSE({
				event: "end",
				data: JSON.stringify({ ok: true }),
			});
		});
	});

	router.get("/:id", (c) => {
		const booking = BOOKINGS.get(c.req.param("id"));
		if (!booking) {
			return c.json(errBody("BOOKING_NOT_FOUND", "Booking not found", c), 404);
		}
		if (booking.ownerSubject !== c.get("ownerSubject")) {
			return c.json(errBody("BOOKING_FORBIDDEN", "Not your booking", c), 403);
		}

		return c.json({ data: booking });
	});

	return router;
}

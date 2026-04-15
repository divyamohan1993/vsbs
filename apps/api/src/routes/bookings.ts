// =============================================================================
// /v1/bookings/:id/stream — SSE endpoint the web LiveTicker subscribes to.
//
// In production this would fan-out Pub/Sub events for a real booking.
// For v0.1 sim mode we emit a deterministic Maister-aligned status
// timeline so the UX can be exercised end-to-end with zero backend.
// The shape of each event matches docs/research/wellbeing.md §3 rule
// #3 "Show progress, never raw spinners".
// =============================================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AppEnv } from "../middleware/security.js";

/** One frame of the booking-status timeline. */
export interface BookingFrame {
  at: string;
  status: string;
  etaMinutes: number;
  wellbeing: number;
  explanation: string;
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
      explanation: "On the Outer Ring Road. Light traffic. Wellbeing remains high — quote already locked.",
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
      explanation: "Service complete. Driver Priya is returning the vehicle now. Wellbeing score 0.90.",
    },
  ];
}

export function buildBookingsRouter() {
  const router = new Hono<AppEnv>();

  router.get("/:id/stream", (c) => {
    const id = c.req.param("id");
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

  return router;
}

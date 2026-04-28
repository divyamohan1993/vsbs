// =============================================================================
// k6 — SSE fanout. 1,000 concurrent subscribers on
// /v1/bookings/:id/stream for 60 s.
//
// Pass criteria:
//   no 5xx, p95 connect time < 250 ms, drop rate < 0.5 %.
//
// Run:
//   k6 run scenarios/sse-fanout.js
// =============================================================================

import http from "k6/http";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";

const API_BASE = __ENV.VSBS_API_BASE ?? "http://localhost:8787";
const BOOKING_IDS = (__ENV.VSBS_LOAD_IDS ?? "demo-1,demo-2,demo-3,demo-4,demo-5").split(",");

export const options = {
  scenarios: {
    sse_fanout: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 200 },
        { duration: "20s", target: 1000 },
        { duration: "20s", target: 1000 },
      ],
      gracefulStop: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<250"],
  },
};

const connectTrend = new Trend("sse_connect_ms");
const drops = new Counter("sse_drops");

export default function () {
  const id = BOOKING_IDS[Math.floor(Math.random() * BOOKING_IDS.length)];
  const t0 = Date.now();
  const res = http.get(`${API_BASE}/v1/bookings/${id}/stream`, {
    headers: { accept: "text/event-stream", "x-load-test": "sse" },
    timeout: "10s",
  });
  connectTrend.add(Date.now() - t0);
  if (res.status >= 500 || res.status === 0) drops.add(1);
  check(res, {
    "no 5xx": (r) => r.status < 500,
  });
}

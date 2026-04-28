// =============================================================================
// k6 — booking burst. 200 RPS for 5 min on POST /v1/bookings with realistic
// payload variation across VINs, regions, and dispatch modes.
//
// Pass criteria:
//   p95 < 500 ms
//   error rate < 1 %
//
// Run:
//   k6 run scenarios/booking-burst.js
// =============================================================================

import http from "k6/http";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";
import { randomItem, randomIntBetween } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const API_BASE = __ENV.VSBS_API_BASE ?? "http://localhost:8787";

const VINS = [
  "1HGCM82633A004352",
  "JH4DA9450NS000111",
  "WBA8E9C50GK000111",
  "5UXKR0C58F0K00111",
  "5YJSA1E26HF000111",
];
const PINCODES = ["110001", "560001", "400001", "600001", "700001"];
const MODES = ["drive-in", "mobile-mechanic", "pickup-drop", "tow"];

export const options = {
  scenarios: {
    booking_burst: {
      executor: "constant-arrival-rate",
      rate: 200,
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 200,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const trend = new Trend("booking_post_latency");
const errs = new Rate("booking_post_errors");

export default function () {
  const vin = randomItem(VINS);
  const pin = randomItem(PINCODES);
  const mode = randomItem(MODES);
  const body = JSON.stringify({
    owner: { name: `LoadTest ${randomIntBetween(1, 99999)}`, phone: "+919876543210" },
    vehicle: { vin, make: "Honda", model: "Civic", year: 2024, fuel: "petrol", transmission: "amt", odometerKm: 35000 },
    pickupMode: mode,
    pincode: pin,
  });
  const res = http.post(`${API_BASE}/v1/bookings`, body, {
    headers: { "content-type": "application/json", "x-load-test": "burst" },
    timeout: "10s",
  });
  trend.add(res.timings.duration);
  errs.add(res.status >= 500 || res.status === 0);
  check(res, {
    "status is 2xx or 4xx (no 5xx)": (r) => r.status < 500,
  });
}

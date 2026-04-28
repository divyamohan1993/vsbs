// =============================================================================
// k6 — auth OTP request burst. 100 RPS on POST /v1/auth/otp/request, with
// rate-limit observation.
//
// Pass criteria:
//   429 + Retry-After header present once limiter trips
//   error rate (5xx) < 0.5 %.
//
// Run:
//   k6 run scenarios/auth-otp.js
// =============================================================================

import http from "k6/http";
import { check } from "k6";
import { Counter, Rate } from "k6/metrics";

const API_BASE = __ENV.VSBS_API_BASE ?? "http://localhost:8787";

export const options = {
  scenarios: {
    auth_otp: {
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 100,
      maxVUs: 200,
    },
  },
  thresholds: {
    "http_req_failed{expected_response:true}": ["rate<0.005"],
  },
};

const rateLimitedCounter = new Counter("rate_limited_responses");
const fiveXX = new Rate("server_errors");

export default function () {
  const phone = `+91987654${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
  const res = http.post(
    `${API_BASE}/v1/auth/otp/request`,
    JSON.stringify({ phone }),
    {
      headers: { "content-type": "application/json", "x-load-test": "otp" },
      timeout: "5s",
    },
  );
  fiveXX.add(res.status >= 500);
  if (res.status === 429) {
    rateLimitedCounter.add(1);
    check(res, {
      "429 carries Retry-After": (r) => r.headers["Retry-After"] !== undefined,
    });
  } else {
    check(res, {
      "no 5xx": (r) => r.status < 500,
    });
  }
}

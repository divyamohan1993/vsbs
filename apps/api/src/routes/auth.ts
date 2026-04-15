// =============================================================================
// Auth routes — demo-mode OTP. The state machine is identical in sim and
// live; only the dispatch transport differs. docs/simulation-policy.md.
// =============================================================================

import { Hono } from "hono";
import { zv } from "../middleware/zv.js";
import {
  OtpStartRequestSchema,
  OtpVerifyRequestSchema,
  type OtpStartResponse,
  type OtpVerifyResponse,
} from "@vsbs/shared";

import {
  OtpMemoryStore,
  startOtp,
  verifyOtp,
  type OtpConfig,
} from "../adapters/auth/otp-state.js";
import { OtpSimDriver, OtpTwilioDriver, OtpMsg91Driver, type OtpDriver } from "../adapters/auth/otp-driver.js";
import type { Env } from "../env.js";

export function buildAuthRouter(env: Env) {
  const router = new Hono();
  const cfg: OtpConfig = {
    length: env.AUTH_OTP_LENGTH,
    ttlSeconds: env.AUTH_OTP_TTL_SECONDS,
    maxAttempts: env.AUTH_OTP_MAX_ATTEMPTS,
    lockoutSeconds: env.AUTH_OTP_LOCKOUT_SECONDS,
  };
  const store = new OtpMemoryStore();

  const driver: OtpDriver =
    env.AUTH_MODE === "live"
      ? env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID
        ? new OtpTwilioDriver({
            accountSid: env.TWILIO_ACCOUNT_SID,
            authToken: env.TWILIO_AUTH_TOKEN,
            verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID,
          })
        : env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID
          ? new OtpMsg91Driver({ authKey: env.MSG91_AUTH_KEY, templateId: env.MSG91_TEMPLATE_ID })
          : new OtpSimDriver()
      : new OtpSimDriver();

  router.post("/start", zv("json", OtpStartRequestSchema), async (c) => {
    const req = c.req.valid("json");
    const { state } = startOtp(req, cfg, store);
    const dispatched = await driver.dispatch(state);
    const body: OtpStartResponse = {
      challengeId: state.challengeId,
      expiresAt: new Date(state.expiresAt).toISOString(),
      length: cfg.length,
      deliveryHint: dispatched.deliveryHint,
      ...(dispatched.demoCode !== undefined ? { demoCode: dispatched.demoCode } : {}),
    };
    return c.json({ data: body });
  });

  router.post("/verify", zv("json", OtpVerifyRequestSchema), (c) => {
    const req = c.req.valid("json");
    const res = verifyOtp(req, cfg, store);
    if (!res.ok) return c.json({ error: res.error }, 400);
    const body: OtpVerifyResponse = { ok: true, subject: res.subject, purpose: "login" };
    return c.json({ data: body });
  });

  return router;
}

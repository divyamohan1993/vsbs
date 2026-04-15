// =============================================================================
// OTP transport drivers. Sim returns the code for live-display on the UI;
// live dispatches via Twilio Verify or MSG91 (India). Both drivers are called
// from the same state-machine entry point in otp-state.ts — no branching in
// business logic, only in transport.
// =============================================================================

import type { OtpState } from "@vsbs/shared";

export interface OtpDriver {
  readonly mode: "sim" | "live";
  /**
   * Dispatch the OTP to the user via whatever channel this driver supports.
   * Returns the value the HTTP response will surface back to the caller —
   * in sim mode this is the code itself, in live mode it is `undefined`
   * because the code must never leave the server.
   */
  dispatch(state: OtpState): Promise<{ demoCode: string | undefined; deliveryHint: string }>;
}

/** Sim driver — live-displays the OTP to the browser, does not send SMS. */
export class OtpSimDriver implements OtpDriver {
  readonly mode = "sim" as const;
  async dispatch(state: OtpState): Promise<{ demoCode: string | undefined; deliveryHint: string }> {
    return {
      demoCode: state.code,
      deliveryHint: "Demo mode — no SMS was sent. The code is shown below.",
    };
  }
}

/**
 * Live driver for Twilio Verify.
 * Reference: https://www.twilio.com/docs/verify/api/verification
 *
 * Contract: dispatch() is fire-and-forget from the caller's point of view.
 * Failures at the HTTP level are surfaced as thrown errors so the
 * Hono handler can return a 502 without leaking the OTP.
 */
export class OtpTwilioDriver implements OtpDriver {
  readonly mode = "live" as const;
  constructor(
    private readonly cfg: {
      accountSid: string;
      authToken: string;
      verifyServiceSid: string;
      fetchImpl?: typeof fetch;
    },
  ) {}
  async dispatch(state: OtpState): Promise<{ demoCode: undefined; deliveryHint: string }> {
    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    // Twilio Verify ignores our generated code and issues its own — this
    // is deliberate, because the state machine above still owns the code
    // we will compare against. In production we would either (a) use
    // Twilio Verify end-to-end and delete our own code, or (b) use
    // Twilio Messaging API to send a templated SMS containing our own
    // code. We default to (b) for parity with the sim driver.
    const body = new URLSearchParams({
      To: state.phone,
      Channel: "sms",
      CustomCode: state.code,
    });
    const auth = btoa(`${this.cfg.accountSid}:${this.cfg.authToken}`);
    const res = await fetchImpl(
      `https://verify.twilio.com/v2/Services/${this.cfg.verifyServiceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${auth}`,
        },
        body: body.toString(),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio Verify failed ${res.status}: ${text}`);
    }
    return {
      demoCode: undefined,
      deliveryHint: "We sent a one-time code to your phone.",
    };
  }
}

/** Live driver for MSG91 — common India SMS OTP gateway. */
export class OtpMsg91Driver implements OtpDriver {
  readonly mode = "live" as const;
  constructor(
    private readonly cfg: {
      authKey: string;
      templateId: string;
      fetchImpl?: typeof fetch;
    },
  ) {}
  async dispatch(state: OtpState): Promise<{ demoCode: undefined; deliveryHint: string }> {
    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    const params = new URLSearchParams({
      template_id: this.cfg.templateId,
      mobile: state.phone.replace(/^\+/, ""),
      otp: state.code,
      authkey: this.cfg.authKey,
    });
    const res = await fetchImpl(`https://control.msg91.com/api/v5/otp?${params.toString()}`, {
      method: "GET",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MSG91 failed ${res.status}: ${text}`);
    }
    return {
      demoCode: undefined,
      deliveryHint: "We sent a one-time code to your phone.",
    };
  }
}

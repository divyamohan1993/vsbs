// =============================================================================
// OTP auth — shared types. Implementations live in apps/api/src/adapters/auth.
// SIM and LIVE drivers share the state machine and differ only in transport.
// See docs/simulation-policy.md.
// =============================================================================

import { z } from "zod";
import { E164Schema } from "./schema/intake.js";

export const OtpPurposeSchema = z.enum([
  "login",
  "signup",
  "command-grant-sign",
  "autopay-authorise",
  "consent-confirm",
]);
export type OtpPurpose = z.infer<typeof OtpPurposeSchema>;

export const OtpStartRequestSchema = z.object({
  phone: E164Schema,
  purpose: OtpPurposeSchema,
  locale: z.string().min(2).max(5).default("en"),
});
export type OtpStartRequest = z.infer<typeof OtpStartRequestSchema>;

export const OtpStartResponseSchema = z.object({
  challengeId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  length: z.number().int().min(4).max(10),
  /**
   * Only populated in sim / demo mode. In live mode this field is
   * always absent. The UI uses its presence to show the live-display
   * banner. See docs/simulation-policy.md.
   */
  demoCode: z.string().optional(),
  /** Always present; describes what the UI should show the user. */
  deliveryHint: z.string(),
});
export type OtpStartResponse = z.infer<typeof OtpStartResponseSchema>;

export const OtpVerifyRequestSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().min(4).max(10),
});
export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequestSchema>;

export const OtpVerifyResponseSchema = z.object({
  ok: z.literal(true),
  subject: z.string(),
  purpose: OtpPurposeSchema,
});
export type OtpVerifyResponse = z.infer<typeof OtpVerifyResponseSchema>;

export type OtpError =
  | { code: "OTP_INVALID" }
  | { code: "OTP_EXPIRED" }
  | { code: "OTP_LOCKED"; unlockAt: string }
  | { code: "OTP_ATTEMPTS_EXCEEDED" }
  | { code: "OTP_CHALLENGE_NOT_FOUND" };

export interface OtpState {
  challengeId: string;
  phone: string;
  code: string;
  purpose: OtpPurpose;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  lockedUntil: number | null;
  locale: string;
}

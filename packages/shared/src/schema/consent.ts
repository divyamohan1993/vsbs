import { z } from "zod";

/**
 * DPDP Rules 2025 — per-purpose, unbundled, withdrawable consent record.
 * Appended to Firestore `consent_log` per user. Immutable; withdrawal is a
 * new row, not an edit. See docs/research/security.md §2.
 */
export const ConsentPurposeSchema = z.enum([
  "service-fulfilment",        // required
  "diagnostic-telemetry",      // required if connected-car path used
  "voice-photo-processing",    // required if used
  "marketing",                 // opt-in
  "ml-improvement-anonymised", // opt-in
  "autonomy-delegation",       // opt-in, required for Tier A flow
  "autopay-within-cap",        // opt-in, required for auto-pay
]);
export type ConsentPurpose = z.infer<typeof ConsentPurposeSchema>;

export const ConsentRecordSchema = z.object({
  recordId: z.string().uuid(),
  ownerId: z.string().uuid(),
  purpose: ConsentPurposeSchema,
  granted: z.boolean(),
  noticeVersion: z.string().min(1),
  legalBasis: z.enum(["consent", "contract", "legal-obligation", "vital-interest"]),
  timestamp: z.string().datetime(),
  ipRedacted: z.string().max(4).describe("First /24 of IP kept for audit, last octet redacted"),
  userAgentRedacted: z.string().max(200).optional(),
  evidenceHash: z.string().length(64).describe("SHA-256 of the notice the user actually saw"),
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

/**
 * Tightly-scoped consent bundle a client presents at intake. Each purpose
 * has its own toggle; no dark pattern (marketing defaults to false).
 */
export const ConsentBundleSchema = z.object({
  noticeVersion: z.string().min(1),
  items: z
    .array(
      z.object({
        purpose: ConsentPurposeSchema,
        granted: z.boolean(),
      }),
    )
    .min(1),
});
export type ConsentBundle = z.infer<typeof ConsentBundleSchema>;

/**
 * A notice version is immutable; when content changes, we bump the version
 * and force a re-consent. See DPDP Rule 3 (notice).
 */
export const ConsentNoticeSchema = z.object({
  version: z.string(),
  locales: z.record(z.string(), z.string()),
  effectiveFrom: z.string().datetime(),
  effectiveUntil: z.string().datetime().optional(),
  hash: z.string().length(64),
});
export type ConsentNotice = z.infer<typeof ConsentNoticeSchema>;

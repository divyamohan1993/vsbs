// =============================================================================
// CSP nonce + policy builder.
//
// References:
//   docs/research/security.md §6 (HTTP security headers baseline)
//   docs/research/security.md §4 LLM01 (separate trusted/untrusted contexts)
//   W3C Content Security Policy Level 3 — strict-dynamic, nonce sources.
//
// Strict, nonce-based CSP. No `unsafe-inline`, no `unsafe-eval`. The web
// proxy and the API both use this builder so the policy stays consistent
// across the system. Region-aware: in-region (asia-south1) connect-src
// allows the regional API base; out-of-region uses the global base.
// =============================================================================

import { z } from "zod";

export const CSP_NONCE_BYTES = 16;

export function makeCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CSP_NONCE_BYTES));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/=+$/, "");
}

export const CspRegionSchema = z.enum(["asia-south1", "asia-south2", "us-central1", "europe-west1"]);
export type CspRegion = z.infer<typeof CspRegionSchema>;

export const CspBuildOptionsSchema = z.object({
  nonce: z.string().min(8),
  region: CspRegionSchema,
  /** Additional connect-src origins permitted (e.g. partner OEM API). */
  extraConnectSrc: z.array(z.string().url()).default([]),
  /** Additional script-src hashes (sha256-…) for legacy inline blocks. */
  scriptHashes: z.array(z.string().regex(/^sha256-[A-Za-z0-9+/=]+$/)).default([]),
  /** When true, emits Content-Security-Policy-Report-Only. */
  reportOnly: z.boolean().default(false),
  /** Endpoint for CSP violation reports. */
  reportUri: z.string().default("/api/_/csp-report"),
});
export type CspBuildOptions = z.input<typeof CspBuildOptionsSchema>;

const REGION_API_BASE: Record<CspRegion, string> = {
  "asia-south1": "https://api-asia-south1.vsbs.app",
  "asia-south2": "https://api-asia-south2.vsbs.app",
  "us-central1": "https://api-us-central1.vsbs.app",
  "europe-west1": "https://api-europe-west1.vsbs.app",
};

const FIXED_CONNECT_SRC = [
  "https://routes.googleapis.com",
  "https://vpic.nhtsa.dot.gov",
  "https://api.anthropic.com",
  "https://generativelanguage.googleapis.com",
];

export interface CspBuildResult {
  headerName: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
  value: string;
}

export function buildCspHeader(rawOpts: CspBuildOptions): CspBuildResult {
  const opts = CspBuildOptionsSchema.parse(rawOpts);
  const apiBase = REGION_API_BASE[opts.region];
  const connectSrc = ["'self'", apiBase, ...FIXED_CONNECT_SRC, ...opts.extraConnectSrc];

  const scriptSrc = [
    "'self'",
    `'nonce-${opts.nonce}'`,
    ...opts.scriptHashes.map((h) => `'${h}'`),
    "'strict-dynamic'",
    "https:",
  ];

  const directives: string[] = [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'nonce-${opts.nonce}'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `upgrade-insecure-requests`,
    `report-uri ${opts.reportUri}`,
  ];

  return {
    headerName: opts.reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
    value: directives.join("; "),
  };
}

/**
 * Helper to build the full set of security headers in one call. Used by both
 * the Next.js proxy and the API error pages.
 */
export function buildSecurityHeaders(opts: CspBuildOptions): Record<string, string> {
  const csp = buildCspHeader(opts);
  return {
    [csp.headerName]: csp.value,
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self), payment=()",
    "X-Frame-Options": "DENY",
  };
}

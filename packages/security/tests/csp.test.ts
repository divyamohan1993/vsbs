import { describe, it, expect } from "vitest";
import { buildCspHeader, buildSecurityHeaders, makeCspNonce, CSP_NONCE_BYTES } from "../src/csp.js";

describe("CSP nonce + builder", () => {
  it("nonce is base64url with at least 16 bytes of entropy", () => {
    const n = makeCspNonce();
    expect(n.length).toBeGreaterThanOrEqual(Math.ceil((CSP_NONCE_BYTES * 4) / 3) - 2);
    expect(n).not.toContain("=");
  });

  it("script-src includes the nonce and not unsafe-inline", () => {
    const r = buildCspHeader({ nonce: "abc12345", region: "asia-south1" });
    expect(r.value).toContain("'nonce-abc12345'");
    expect(r.value).not.toContain("'unsafe-inline'");
    expect(r.value).not.toContain("'unsafe-eval'");
  });

  it("connect-src includes the regional API base", () => {
    const r = buildCspHeader({ nonce: "abcdefgh", region: "asia-south1" });
    expect(r.value).toContain("https://api-asia-south1.vsbs.app");
  });

  it("supports report-only mode", () => {
    const r = buildCspHeader({ nonce: "abcdefgh", region: "us-central1", reportOnly: true });
    expect(r.headerName).toBe("Content-Security-Policy-Report-Only");
  });

  it("buildSecurityHeaders emits HSTS, nosniff, referrer-policy, COOP", () => {
    const h = buildSecurityHeaders({ nonce: "abcdefgh", region: "asia-south1" });
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=63072000/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("rejects malformed script hashes", () => {
    expect(() =>
      buildCspHeader({
        nonce: "abcdefgh",
        region: "asia-south1",
        scriptHashes: ["not-a-hash"],
      }),
    ).toThrow();
  });
});

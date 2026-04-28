import { describe, expect, it } from "vitest";
import { canonicalize, bytesToHex, hexToBytes, sha256Hex } from "../src/lib/audit-crypto";

describe("audit-crypto", () => {
  it("canonicalize sorts object keys deterministically", () => {
    const a = canonicalize({ b: 1, a: 2 });
    const b = canonicalize({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it("canonicalize preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("canonicalize handles nested objects", () => {
    expect(
      canonicalize({ outer: { z: 1, a: { y: "two", x: 1 } } }),
    ).toBe('{"outer":{"a":{"x":1,"y":"two"},"z":1}}');
  });

  it("canonicalize escapes strings via JSON.stringify", () => {
    expect(canonicalize('hello "world"')).toBe('"hello \\"world\\""');
  });

  it("hexToBytes round-trips", () => {
    const hex = "00ff10ab";
    const bytes = hexToBytes(hex);
    expect(bytesToHex(bytes)).toBe(hex);
  });

  it("sha256Hex returns 64 hex characters", async () => {
    const digest = await sha256Hex(new TextEncoder().encode("vsbs"));
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]+$/);
  });
});

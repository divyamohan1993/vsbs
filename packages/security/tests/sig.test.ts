import { describe, it, expect } from "vitest";
import { makeMlDsa65Signer, ML_DSA_65_ALG, ML_DSA_65_PK, ML_DSA_65_SK, ML_DSA_65_SIG } from "../src/sig.js";

describe("ML-DSA-65 signer", () => {
  it("declares the canonical algorithm identifier", () => {
    const s = makeMlDsa65Signer();
    expect(s.alg).toBe(ML_DSA_65_ALG);
    expect(s.sigLength).toBe(ML_DSA_65_SIG);
  });

  it("keygen produces fixed-length keys (FIPS 204)", () => {
    const s = makeMlDsa65Signer();
    const kp = s.keygen();
    expect(kp.publicKey.length).toBe(ML_DSA_65_PK);
    expect(kp.secretKey.length).toBe(ML_DSA_65_SK);
  });

  it("sign + verify round-trip on a non-empty message", () => {
    const s = makeMlDsa65Signer();
    const kp = s.keygen();
    const msg = new TextEncoder().encode("VSBS command-grant witness payload v1");
    const sig = s.sign(msg, kp.secretKey);
    expect(sig.length).toBe(ML_DSA_65_SIG);
    expect(s.verify(sig, msg, kp.publicKey)).toBe(true);
  });

  it("verify rejects a tampered message", () => {
    const s = makeMlDsa65Signer();
    const kp = s.keygen();
    const msg = new TextEncoder().encode("payload-A");
    const sig = s.sign(msg, kp.secretKey);
    const tampered = new TextEncoder().encode("payload-B");
    expect(s.verify(sig, tampered, kp.publicKey)).toBe(false);
  });

  it("verify rejects a tampered signature", () => {
    const s = makeMlDsa65Signer();
    const kp = s.keygen();
    const msg = new TextEncoder().encode("hello");
    const sig = s.sign(msg, kp.secretKey);
    const tampered = new Uint8Array(sig);
    tampered[0] = (tampered[0]! ^ 0xff) & 0xff;
    expect(s.verify(tampered, msg, kp.publicKey)).toBe(false);
  });

  it("verify returns false on a mis-sized signature instead of throwing", () => {
    const s = makeMlDsa65Signer();
    const kp = s.keygen();
    const msg = new TextEncoder().encode("hello");
    expect(s.verify(new Uint8Array(10), msg, kp.publicKey)).toBe(false);
  });
});

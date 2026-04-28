import { describe, it, expect } from "vitest";
import {
  makeHybridKem,
  HYBRID_KEM_ALG,
  HYBRID_PK_LEN,
  HYBRID_SK_LEN,
  HYBRID_CT_LEN,
  HYBRID_SS_LEN,
} from "../src/pq.js";

describe("PqHybridKem (X25519 + ML-KEM-768)", () => {
  it("declares the canonical algorithm identifier", () => {
    const kem = makeHybridKem();
    expect(kem.alg).toBe(HYBRID_KEM_ALG);
    expect(HYBRID_KEM_ALG).toBe("ML-KEM-768+X25519");
  });

  it("keygen produces fixed-length public + secret keys", () => {
    const kem = makeHybridKem();
    const kp = kem.keygen();
    expect(kp.publicKey.length).toBe(HYBRID_PK_LEN);
    expect(kp.secretKey.length).toBe(HYBRID_SK_LEN);
  });

  it("encapsulate -> decapsulate yields identical shared secret", () => {
    const kem = makeHybridKem();
    const kp = kem.keygen();
    const enc = kem.encapsulate(kp.publicKey);
    expect(enc.cipherText.length).toBe(HYBRID_CT_LEN);
    expect(enc.sharedSecret.length).toBe(HYBRID_SS_LEN);
    const ss2 = kem.decapsulate(enc.cipherText, kp.secretKey);
    expect(ss2.length).toBe(HYBRID_SS_LEN);
    expect(ss2).toEqual(enc.sharedSecret);
  });

  it("two independent keypairs do not produce the same shared secret", () => {
    const kem = makeHybridKem();
    const a = kem.keygen();
    const b = kem.keygen();
    const ea = kem.encapsulate(a.publicKey);
    const eb = kem.encapsulate(b.publicKey);
    expect(ea.sharedSecret).not.toEqual(eb.sharedSecret);
  });

  it("decapsulate with wrong secret key produces a different shared secret", () => {
    const kem = makeHybridKem();
    const kp = kem.keygen();
    const wrong = kem.keygen();
    const enc = kem.encapsulate(kp.publicKey);
    const wrongSs = kem.decapsulate(enc.cipherText, wrong.secretKey);
    expect(wrongSs).not.toEqual(enc.sharedSecret);
  });

  it("rejects malformed public key length", () => {
    const kem = makeHybridKem();
    expect(() => kem.encapsulate(new Uint8Array(10))).toThrow();
  });

  it("rejects malformed ciphertext length on decapsulate", () => {
    const kem = makeHybridKem();
    const kp = kem.keygen();
    expect(() => kem.decapsulate(new Uint8Array(100), kp.secretKey)).toThrow();
  });
});

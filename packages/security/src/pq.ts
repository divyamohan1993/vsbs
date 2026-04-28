// =============================================================================
// Post-quantum hybrid KEM — X25519 + ML-KEM-768.
//
// References:
//   docs/research/security.md §1 (FIPS 203, hybrid TLS, KMS PQ envelope)
//   NIST FIPS 203 (ML-KEM)
//   draft-ietf-tls-mlkem (X25519MLKEM768 hybrid group for TLS 1.3)
//   IETF: hybrid public key encryption, RFC 9180 (HPKE) shape for the
//   shared-secret derivation: `ss = HKDF-SHA-256(ss_pq || ss_ec)`.
//
// Both component KEMs run in parallel; both ciphertexts and both shared
// secrets are required to recover the final shared secret. This is the
// standard "concatenation KEM" combiner from Bindel-Brendel-Fischlin-Goncalves
// 2019 ("Hybrid key encapsulation mechanisms and authenticated key
// exchange") and the construction used by `X25519MLKEM768` in TLS 1.3.
//
// Implementation: real ML-KEM-768 from `@noble/post-quantum` (FIPS 203
// reference port, published Apr 2026 v0.6.x). X25519 from `@noble/curves`
// (audited). HKDF-SHA-256 from `@noble/hashes`. No placeholders; all
// algorithms are real and standards-tracked.
// =============================================================================

import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";

/** Algorithm identifier for the hybrid KEM. */
export const HYBRID_KEM_ALG = "ML-KEM-768+X25519" as const;
export type HybridKemAlg = typeof HYBRID_KEM_ALG;

/** Component byte lengths — fixed by FIPS 203 / RFC 7748. */
export const ML_KEM_768_PK = 1184;
export const ML_KEM_768_SK = 2400;
export const ML_KEM_768_CT = 1088;
export const ML_KEM_768_SS = 32;
export const X25519_KEY = 32;
export const X25519_SS = 32;

/** Public key = ML-KEM-768 pk || X25519 pk. */
export const HYBRID_PK_LEN = ML_KEM_768_PK + X25519_KEY;
/** Secret key = ML-KEM-768 sk || X25519 sk. */
export const HYBRID_SK_LEN = ML_KEM_768_SK + X25519_KEY;
/** Ciphertext = ML-KEM-768 ct || X25519 ephemeral pk. */
export const HYBRID_CT_LEN = ML_KEM_768_CT + X25519_KEY;
/** Combined shared secret length (HKDF-SHA-256 output, truncated to 32 bytes). */
export const HYBRID_SS_LEN = 32;

export const HybridKeypairSchema = z.object({
  publicKey: z.instanceof(Uint8Array).refine((a) => a.length === HYBRID_PK_LEN, {
    message: `publicKey must be ${HYBRID_PK_LEN} bytes`,
  }),
  secretKey: z.instanceof(Uint8Array).refine((a) => a.length === HYBRID_SK_LEN, {
    message: `secretKey must be ${HYBRID_SK_LEN} bytes`,
  }),
});
export type HybridKeypair = z.infer<typeof HybridKeypairSchema>;

export const HybridEncapsulationSchema = z.object({
  cipherText: z.instanceof(Uint8Array).refine((a) => a.length === HYBRID_CT_LEN, {
    message: `cipherText must be ${HYBRID_CT_LEN} bytes`,
  }),
  sharedSecret: z.instanceof(Uint8Array).refine((a) => a.length === HYBRID_SS_LEN, {
    message: `sharedSecret must be ${HYBRID_SS_LEN} bytes`,
  }),
});
export type HybridEncapsulation = z.infer<typeof HybridEncapsulationSchema>;

/**
 * Hybrid KEM interface. Two components in parallel; both must succeed.
 * O(1) in input size — every operation is bounded by the FIPS 203 / RFC 7748
 * fixed shapes.
 */
export interface PqHybridKem {
  readonly alg: HybridKemAlg;
  keygen(): HybridKeypair;
  encapsulate(publicKey: Uint8Array): HybridEncapsulation;
  decapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array;
}

function ensureLength(buf: Uint8Array, expected: number, name: string): void {
  if (buf.length !== expected) {
    throw new Error(`${name}: expected ${expected} bytes, got ${buf.length}`);
  }
}

function combineSharedSecrets(
  ssPq: Uint8Array,
  ssEc: Uint8Array,
  ctEc: Uint8Array,
  pkEcPeer: Uint8Array,
): Uint8Array {
  const ikm = new Uint8Array(ssPq.length + ssEc.length + ctEc.length + pkEcPeer.length);
  let off = 0;
  ikm.set(ssPq, off); off += ssPq.length;
  ikm.set(ssEc, off); off += ssEc.length;
  ikm.set(ctEc, off); off += ctEc.length;
  ikm.set(pkEcPeer, off);
  const info = new TextEncoder().encode(`vsbs/${HYBRID_KEM_ALG}/v1`);
  const salt = new Uint8Array(0);
  return hkdf(sha256, ikm, salt, info, HYBRID_SS_LEN);
}

/**
 * Build the hybrid KEM. Live and sim modes both use the same real algorithms;
 * the only difference between modes is whether key material persists across
 * restarts (sim regenerates per process). The sim/live distinction at the
 * KMS layer (kms-envelope.ts) decides where these primitives are sourced.
 */
export function makeHybridKem(): PqHybridKem {
  return {
    alg: HYBRID_KEM_ALG,
    keygen(): HybridKeypair {
      const pq = ml_kem768.keygen();
      const ec = x25519.keygen();
      const publicKey = new Uint8Array(HYBRID_PK_LEN);
      publicKey.set(pq.publicKey, 0);
      publicKey.set(ec.publicKey, ML_KEM_768_PK);
      const secretKey = new Uint8Array(HYBRID_SK_LEN);
      secretKey.set(pq.secretKey, 0);
      secretKey.set(ec.secretKey, ML_KEM_768_SK);
      return HybridKeypairSchema.parse({ publicKey, secretKey });
    },
    encapsulate(publicKey: Uint8Array): HybridEncapsulation {
      ensureLength(publicKey, HYBRID_PK_LEN, "publicKey");
      const pkPq = publicKey.subarray(0, ML_KEM_768_PK);
      const pkEc = publicKey.subarray(ML_KEM_768_PK, ML_KEM_768_PK + X25519_KEY);
      const pq = ml_kem768.encapsulate(pkPq);
      const ephem = x25519.keygen();
      const ssEc = x25519.getSharedSecret(ephem.secretKey, pkEc);
      const cipherText = new Uint8Array(HYBRID_CT_LEN);
      cipherText.set(pq.cipherText, 0);
      cipherText.set(ephem.publicKey, ML_KEM_768_CT);
      const sharedSecret = combineSharedSecrets(pq.sharedSecret, ssEc, ephem.publicKey, pkEc);
      return HybridEncapsulationSchema.parse({ cipherText, sharedSecret });
    },
    decapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array {
      ensureLength(cipherText, HYBRID_CT_LEN, "cipherText");
      ensureLength(secretKey, HYBRID_SK_LEN, "secretKey");
      const ctPq = cipherText.subarray(0, ML_KEM_768_CT);
      const ephemPk = cipherText.subarray(ML_KEM_768_CT, ML_KEM_768_CT + X25519_KEY);
      const skPq = secretKey.subarray(0, ML_KEM_768_SK);
      const skEc = secretKey.subarray(ML_KEM_768_SK, ML_KEM_768_SK + X25519_KEY);
      const ssPq = ml_kem768.decapsulate(ctPq, skPq);
      const ssEc = x25519.getSharedSecret(skEc, ephemPk);
      const ss = combineSharedSecrets(ssPq, ssEc, ephemPk, x25519.getPublicKey(skEc));
      const out = new Uint8Array(ss.length);
      out.set(ss);
      return out;
    },
  };
}

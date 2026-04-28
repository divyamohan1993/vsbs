// =============================================================================
// Post-quantum digital signatures — ML-DSA-65 (NIST FIPS 204).
//
// References:
//   docs/research/security.md §1 (PQ envelope, code-signing, KMS GA)
//   NIST FIPS 204 (ML-DSA, derived from CRYSTALS-Dilithium)
//   Cloud KMS PQ-signature announcement (2026-Q1) — production GA.
//
// We use ML-DSA-65 (security category 3, ~192-bit classical strength). The
// witness signer in the autonomous handoff (server-side co-sign of every
// CommandGrant) is the primary call site. Code-signing for container
// builds is the secondary call site, gated through Cloud KMS in the live
// driver.
//
// Implementation uses real `@noble/post-quantum` ml_dsa65 — published,
// audited, production reference port of FIPS 204.
// =============================================================================

import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { z } from "zod";

export const ML_DSA_65_ALG = "ML-DSA-65" as const;
export type MlDsa65Alg = typeof ML_DSA_65_ALG;

/** FIPS 204 fixed sizes for ML-DSA-65 (security category 3). */
export const ML_DSA_65_PK = 1952;
export const ML_DSA_65_SK = 4032;
export const ML_DSA_65_SIG = 3309;

export const SignatureKeypairSchema = z.object({
  publicKey: z.instanceof(Uint8Array).refine((a) => a.length === ML_DSA_65_PK, {
    message: `publicKey must be ${ML_DSA_65_PK} bytes`,
  }),
  secretKey: z.instanceof(Uint8Array).refine((a) => a.length === ML_DSA_65_SK, {
    message: `secretKey must be ${ML_DSA_65_SK} bytes`,
  }),
});
export type SignatureKeypair = z.infer<typeof SignatureKeypairSchema>;

/**
 * Post-quantum signer interface. `verify()` returns false on any malformed
 * input or signature mismatch, never throws. The contract matches the
 * existing `GrantSignatureVerifier` in `@vsbs/shared/commandgrant-lifecycle`.
 */
export interface PqSigner {
  readonly alg: MlDsa65Alg;
  readonly sigLength: number;
  keygen(): SignatureKeypair;
  sign(msg: Uint8Array, secretKey: Uint8Array): Uint8Array;
  verify(sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array): boolean;
}

export function makeMlDsa65Signer(): PqSigner {
  return {
    alg: ML_DSA_65_ALG,
    sigLength: ML_DSA_65_SIG,
    keygen(): SignatureKeypair {
      const kp = ml_dsa65.keygen();
      return SignatureKeypairSchema.parse({
        publicKey: new Uint8Array(kp.publicKey),
        secretKey: new Uint8Array(kp.secretKey),
      });
    },
    sign(msg: Uint8Array, secretKey: Uint8Array): Uint8Array {
      if (secretKey.length !== ML_DSA_65_SK) {
        throw new Error(`secretKey must be ${ML_DSA_65_SK} bytes`);
      }
      return new Uint8Array(ml_dsa65.sign(msg, secretKey));
    },
    verify(sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array): boolean {
      if (sig.length !== ML_DSA_65_SIG) return false;
      if (publicKey.length !== ML_DSA_65_PK) return false;
      try {
        return ml_dsa65.verify(sig, msg, publicKey);
      } catch {
        return false;
      }
    },
  };
}

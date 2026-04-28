// =============================================================================
// Bridge between WebAuthn passkey assertions and CommandGrant lifecycle.
//
// References:
//   docs/research/autonomy.md §5 (signed bounded revocable capability)
//   docs/research/security.md §1, §7 (PQ envelope, KMS GA, asset table)
//   packages/shared/src/commandgrant-lifecycle.ts (canonical bytes,
//                                                  Web Crypto verifier).
//
// Flow:
//   1. Server mints a CommandGrantChallenge that wraps a CommandGrantTemplate.
//   2. Server starts a WebAuthn authentication ceremony bound to the same
//      `nonceB64u`. The passkey assertion's clientData.challenge IS the
//      grant nonce, so a successful assertion attests possession of the
//      owner device for that exact grant.
//   3. The server reconstructs the canonical grant bytes, verifies the
//      assertion signature over those bytes (ES256 / EdDSA / RS256), and
//      then witness-signs with ML-DSA-65 to produce a PQ-resilient
//      authority record.
//
// O(1) per call: every step is bounded by fixed-size grant fields,
// fixed-size COSE keys, fixed-size signatures.
// =============================================================================

import {
  AssertionResponseSchema,
  type AssertionResponse,
  type CredentialStore,
  b64uDecode,
  b64uEncode,
  parseAuthenticatorData,
} from "./webauthn.js";
import { makeMlDsa65Signer, type PqSigner, ML_DSA_65_ALG } from "./sig.js";
import {
  canonicalGrantBytes,
  type CommandGrant,
} from "@vsbs/shared";

export interface PasskeyGrantVerificationInput {
  grant: CommandGrant;
  rpId: string;
  expectedOrigin: string;
  assertion: AssertionResponse;
  credentials: CredentialStore;
  /** Required: the canonical grant bytes' base64url, used as the WebAuthn challenge. */
  expectedChallengeB64u: string;
}

export interface PasskeyGrantVerificationOutput {
  ok: boolean;
  reason?: string;
  credentialId?: string;
  algName?: "ES256" | "EdDSA" | "RS256";
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return new Uint8Array(buf);
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i]! ^ b[i]!;
  return r === 0;
}

function derToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) throw new Error("DER not SEQUENCE");
  let off = 2;
  if (der[1]! & 0x80) {
    const lenBytes = der[1]! & 0x7f;
    off = 2 + lenBytes;
  }
  if (der[off] !== 0x02) throw new Error("DER r not INTEGER");
  let rLen = der[off + 1]!;
  let rStart = off + 2;
  if (der[rStart] === 0x00 && rLen > 32) { rStart += 1; rLen -= 1; }
  const r = der.subarray(rStart, rStart + rLen);
  let sOff = rStart + rLen;
  if (der[sOff] !== 0x02) throw new Error("DER s not INTEGER");
  let sLen = der[sOff + 1]!;
  let sStart = sOff + 2;
  if (der[sStart] === 0x00 && sLen > 32) { sStart += 1; sLen -= 1; }
  const s = der.subarray(sStart, sStart + sLen);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

/**
 * Verify a WebAuthn assertion that was raised over a CommandGrant. Returns
 * `{ ok: true }` only when:
 *   - assertion shape is valid (Zod)
 *   - clientData.type == "webauthn.get"
 *   - clientData.origin == expectedOrigin
 *   - clientData.challenge == expectedChallengeB64u
 *   - rpIdHash inside authData == sha256(rpId)
 *   - UP flag set
 *   - signature verifies against the credential's public key
 *   - credential exists in the store
 *   - challenge bytes derive deterministically from canonical grant bytes
 */
export async function verifyPasskeyGrantAssertion(
  input: PasskeyGrantVerificationInput,
): Promise<PasskeyGrantVerificationOutput> {
  AssertionResponseSchema.parse(input.assertion);
  const grantBytes = canonicalGrantBytes(input.grant);
  const expectedChallengeBytes = await sha256(grantBytes);
  const challengeFromInput = b64uDecode(input.expectedChallengeB64u);
  if (!eqBytes(challengeFromInput, expectedChallengeBytes)) {
    return { ok: false, reason: "challenge does not match canonical grant bytes" };
  }
  const clientDataBytes = b64uDecode(input.assertion.response.clientDataJSON);
  let clientData: { type: string; challenge: string; origin: string };
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as typeof clientData;
  } catch {
    return { ok: false, reason: "clientData not JSON" };
  }
  if (clientData.type !== "webauthn.get") return { ok: false, reason: "clientData.type" };
  if (clientData.origin !== input.expectedOrigin) {
    return { ok: false, reason: "clientData.origin" };
  }
  if (clientData.challenge !== input.expectedChallengeB64u) {
    return { ok: false, reason: "clientData.challenge" };
  }

  const cred = input.credentials.byCredId(input.assertion.id);
  if (!cred) return { ok: false, reason: "credential not found" };

  const authData = b64uDecode(input.assertion.response.authenticatorData);
  const parsed = parseAuthenticatorData(authData);
  const expectedRpIdHash = await sha256(new TextEncoder().encode(input.rpId));
  if (!eqBytes(parsed.rpIdHash, expectedRpIdHash)) {
    return { ok: false, reason: "rpIdHash mismatch" };
  }
  if (!parsed.flags.up) return { ok: false, reason: "UP flag not set" };

  const clientDataHash = await sha256(clientDataBytes);
  const signedBytes = new Uint8Array(authData.length + clientDataHash.length);
  signedBytes.set(authData, 0);
  signedBytes.set(clientDataHash, authData.length);

  const sig = b64uDecode(input.assertion.response.signature);
  const ok = await verifyAssertionSig(cred.algName, cred.publicKeyJwk, sig, signedBytes);
  if (!ok) return { ok: false, reason: "signature verification failed" };

  if (parsed.signCount !== 0 && parsed.signCount <= cred.signCount) {
    return { ok: false, reason: "signCount regression" };
  }
  input.credentials.bumpSignCount(cred.credentialId, parsed.signCount);
  return { ok: true, credentialId: cred.credentialId, algName: cred.algName };
}

async function verifyAssertionSig(
  algName: "ES256" | "EdDSA" | "RS256",
  jwk: JsonWebKey,
  sig: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  if (algName === "ES256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      derToRaw(sig) as unknown as ArrayBuffer,
      data as unknown as ArrayBuffer,
    );
  }
  if (algName === "RS256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      sig as unknown as ArrayBuffer,
      data as unknown as ArrayBuffer,
    );
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    sig as unknown as ArrayBuffer,
    data as unknown as ArrayBuffer,
  );
}

// -----------------------------------------------------------------------------
// PQ witness co-signing — server holds an ML-DSA-65 keypair and signs the
// canonical grant bytes after the passkey assertion verifies. Caller stores
// the `signatureB64` under its `witnessId` in the grant's `witnessSignaturesB64`.
// -----------------------------------------------------------------------------

export interface PqWitness {
  readonly witnessId: string;
  readonly publicKey: Uint8Array;
  cosignGrant(grant: CommandGrant): Promise<{
    signatureB64: string;
    alg: typeof ML_DSA_65_ALG;
    witnessId: string;
    mergedGrant: CommandGrant;
  }>;
}

export interface PqWitnessOptions {
  witnessId: string;
  /** If omitted, a fresh ML-DSA-65 key is minted in-process. */
  signer?: PqSigner;
  publicKey?: Uint8Array;
  secretKey?: Uint8Array;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function makePqWitness(opts: PqWitnessOptions): PqWitness {
  const signer = opts.signer ?? makeMlDsa65Signer();
  let pk: Uint8Array;
  let sk: Uint8Array;
  if (opts.publicKey && opts.secretKey) {
    pk = opts.publicKey;
    sk = opts.secretKey;
  } else {
    const kp = signer.keygen();
    pk = kp.publicKey;
    sk = kp.secretKey;
  }
  return {
    witnessId: opts.witnessId,
    publicKey: pk,
    async cosignGrant(grant: CommandGrant): Promise<{
      signatureB64: string;
      alg: typeof ML_DSA_65_ALG;
      witnessId: string;
      mergedGrant: CommandGrant;
    }> {
      const bytes = canonicalGrantBytes(grant);
      const sig = signer.sign(bytes, sk);
      const signatureB64 = bytesToB64(sig);
      const mergedGrant: CommandGrant = {
        ...grant,
        witnessSignaturesB64: {
          ...grant.witnessSignaturesB64,
          [opts.witnessId]: signatureB64,
        },
      };
      return { signatureB64, alg: ML_DSA_65_ALG, witnessId: opts.witnessId, mergedGrant };
    },
  };
}

export function verifyWitnessSignature(
  signer: PqSigner,
  publicKey: Uint8Array,
  grant: CommandGrant,
  signatureB64: string,
): boolean {
  const bytes = canonicalGrantBytes(grant);
  const sig = b64Decode(signatureB64);
  return signer.verify(sig, bytes, publicKey);
}

function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Helper: derive the WebAuthn challenge for a grant (sha256 of canonical bytes). */
export async function challengeForGrant(grant: CommandGrant): Promise<string> {
  const bytes = canonicalGrantBytes(grant);
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return b64uEncode(new Uint8Array(buf));
}

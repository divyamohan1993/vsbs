// =============================================================================
// WebAuthn / passkey ceremonies — Level 3 §6.5 (registration + assertion).
//
// References:
//   docs/research/security.md §4 (LLM06: every privileged tool needs a
//                                  hardware-backed cap signature)
//   W3C WebAuthn Level 3 (March 2024), §5 Authenticator Data, §6.1
//   Authenticator Data layout, §6.5 Authenticator Assertion, §7
//   Registration Ceremony, §7.2 Verifying an Authentication Assertion.
//   RFC 8949 (CBOR — used inside attestationObject and COSE_Key).
//   RFC 8152 (COSE — key encoding inside attestedCredentialData).
//   FIDO Alliance Conformance v2 — packed self attestation, none format.
//
// We deliberately accept the `none` and `packed` self-attestation formats
// only. Indirect / cross-platform attestation needs a metadata service
// integration that is out of scope for the in-process tests; the seam is
// in `verifyAttestationStatement` so the live driver can plug in a
// FIDO MDS3 verifier.
//
// Implementation: pure WebCrypto (ECDSA P-256, RSASSA-PKCS1-v1_5 SHA-256,
// EdDSA Ed25519). No external WebAuthn library — every byte is parsed
// against the spec, with Zod-validated client payloads on every boundary.
// =============================================================================

import { z } from "zod";

// -----------------------------------------------------------------------------
// Base64url
// -----------------------------------------------------------------------------

export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : s.length % 4 === 1 ? "===" : "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// -----------------------------------------------------------------------------
// CBOR (RFC 8949) — minimal decoder for WebAuthn attestation + COSE_Key.
// We only need the major types that appear in these structures:
//   0 unsigned int, 1 negative int, 2 byte string, 3 text string,
//   4 array, 5 map, 7 simple values (true/false/null/undefined/floats).
// Indefinite-length is rejected; WebAuthn never emits it.
// -----------------------------------------------------------------------------

export interface CborDecodeResult {
  value: unknown;
  next: number;
}

export function cborDecode(buf: Uint8Array, offset = 0): CborDecodeResult {
  if (offset >= buf.length) throw new Error("CBOR: out of bounds");
  const initial = buf[offset]!;
  const major = initial >> 5;
  const minor = initial & 0x1f;
  let off = offset + 1;
  const readUint = (m: number): { v: number; off: number } => {
    if (m < 24) return { v: m, off };
    if (m === 24) {
      if (off + 1 > buf.length) throw new Error("CBOR: short uint8");
      return { v: buf[off]!, off: off + 1 };
    }
    if (m === 25) {
      if (off + 2 > buf.length) throw new Error("CBOR: short uint16");
      return { v: (buf[off]! << 8) | buf[off + 1]!, off: off + 2 };
    }
    if (m === 26) {
      if (off + 4 > buf.length) throw new Error("CBOR: short uint32");
      const v =
        (buf[off]! * 0x1000000) +
        ((buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!);
      return { v, off: off + 4 };
    }
    if (m === 27) {
      if (off + 8 > buf.length) throw new Error("CBOR: short uint64");
      const hi = (buf[off]! * 0x1000000) +
        ((buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!);
      const lo = (buf[off + 4]! * 0x1000000) +
        ((buf[off + 5]! << 16) | (buf[off + 6]! << 8) | buf[off + 7]!);
      const v = hi * 0x100000000 + lo;
      if (!Number.isSafeInteger(v)) throw new Error("CBOR: uint64 not safe integer");
      return { v, off: off + 8 };
    }
    throw new Error(`CBOR: unsupported minor ${m}`);
  };
  switch (major) {
    case 0: {
      const { v, off: o } = readUint(minor);
      return { value: v, next: o };
    }
    case 1: {
      const { v, off: o } = readUint(minor);
      return { value: -1 - v, next: o };
    }
    case 2: {
      const { v: len, off: o } = readUint(minor);
      if (o + len > buf.length) throw new Error("CBOR: short bytes");
      return { value: buf.slice(o, o + len), next: o + len };
    }
    case 3: {
      const { v: len, off: o } = readUint(minor);
      if (o + len > buf.length) throw new Error("CBOR: short text");
      return { value: new TextDecoder("utf-8").decode(buf.subarray(o, o + len)), next: o + len };
    }
    case 4: {
      const { v: len, off: o } = readUint(minor);
      let cur = o;
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) {
        const r = cborDecode(buf, cur);
        arr.push(r.value);
        cur = r.next;
      }
      return { value: arr, next: cur };
    }
    case 5: {
      const { v: len, off: o } = readUint(minor);
      let cur = o;
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < len; i++) {
        const k = cborDecode(buf, cur);
        const v = cborDecode(buf, k.next);
        map.set(k.value, v.value);
        cur = v.next;
      }
      return { value: map, next: cur };
    }
    case 7: {
      if (minor === 20) return { value: false, next: off };
      if (minor === 21) return { value: true, next: off };
      if (minor === 22) return { value: null, next: off };
      if (minor === 23) return { value: undefined, next: off };
      throw new Error(`CBOR: unsupported simple ${minor}`);
    }
    default:
      throw new Error(`CBOR: unsupported major ${major}`);
  }
}

// Minimal encoder (used only for tests / fixtures; production never emits
// CBOR — the authenticator does).
export function cborEncode(value: unknown): Uint8Array {
  const parts: number[] = [];
  function writeHead(major: number, n: number): void {
    if (n < 24) parts.push((major << 5) | n);
    else if (n < 0x100) { parts.push((major << 5) | 24); parts.push(n & 0xff); }
    else if (n < 0x10000) { parts.push((major << 5) | 25); parts.push((n >> 8) & 0xff, n & 0xff); }
    else if (n < 0x100000000) {
      parts.push((major << 5) | 26);
      parts.push((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
    } else {
      parts.push((major << 5) | 27);
      const hi = Math.floor(n / 0x100000000);
      const lo = n >>> 0;
      parts.push((hi >> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff);
      parts.push((lo >>> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }
  }
  function emit(v: unknown): void {
    if (v === null) { parts.push(0xf6); return; }
    if (typeof v === "boolean") { parts.push(v ? 0xf5 : 0xf4); return; }
    if (typeof v === "number" && Number.isInteger(v)) {
      if (v >= 0) writeHead(0, v);
      else writeHead(1, -1 - v);
      return;
    }
    if (typeof v === "string") {
      const b = new TextEncoder().encode(v);
      writeHead(3, b.length);
      for (const x of b) parts.push(x);
      return;
    }
    if (v instanceof Uint8Array) {
      writeHead(2, v.length);
      for (const x of v) parts.push(x);
      return;
    }
    if (Array.isArray(v)) {
      writeHead(4, v.length);
      for (const x of v) emit(x);
      return;
    }
    if (v instanceof Map) {
      writeHead(5, v.size);
      const entries = [...v.entries()];
      // Deterministic by canonical-cbor ordering: shorter encoding first,
      // ties broken lexicographically. RFC 8949 §4.2.1.
      entries.sort((a, b) => {
        const ka = cborEncode(a[0]);
        const kb = cborEncode(b[0]);
        if (ka.length !== kb.length) return ka.length - kb.length;
        for (let i = 0; i < ka.length; i++) {
          if (ka[i]! !== kb[i]!) return ka[i]! - kb[i]!;
        }
        return 0;
      });
      for (const [k, val] of entries) {
        emit(k);
        emit(val);
      }
      return;
    }
    throw new Error(`cborEncode: unsupported value type ${typeof v}`);
  }
  emit(value);
  return new Uint8Array(parts);
}

// -----------------------------------------------------------------------------
// Authenticator data (§6.1)
//   rpIdHash (32) | flags (1) | signCount (4) | [attestedCredentialData]?
//
// Flags bits:
//   0 (UP) user present
//   2 (UV) user verified
//   3 (BE) backup eligible
//   4 (BS) backup state
//   6 (AT) attested credential data included
//   7 (ED) extension data included
// -----------------------------------------------------------------------------

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: { up: boolean; uv: boolean; be: boolean; bs: boolean; at: boolean; ed: boolean };
  signCount: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
  credentialPublicKey?: Map<unknown, unknown>;
}

export function parseAuthenticatorData(buf: Uint8Array): ParsedAuthenticatorData {
  if (buf.length < 37) throw new Error("authData too short");
  const rpIdHash = buf.subarray(0, 32);
  const flagsByte = buf[32]!;
  const flags = {
    up: (flagsByte & 0x01) !== 0,
    uv: (flagsByte & 0x04) !== 0,
    be: (flagsByte & 0x08) !== 0,
    bs: (flagsByte & 0x10) !== 0,
    at: (flagsByte & 0x40) !== 0,
    ed: (flagsByte & 0x80) !== 0,
  };
  const signCount =
    (buf[33]! << 24) | (buf[34]! << 16) | (buf[35]! << 8) | buf[36]!;
  const out: ParsedAuthenticatorData = {
    rpIdHash: new Uint8Array(rpIdHash),
    flags,
    signCount: signCount >>> 0,
  };
  let off = 37;
  if (flags.at) {
    if (buf.length < off + 18) throw new Error("attestedCredentialData too short");
    const aaguid = buf.subarray(off, off + 16);
    off += 16;
    const credIdLen = (buf[off]! << 8) | buf[off + 1]!;
    off += 2;
    if (buf.length < off + credIdLen) throw new Error("credentialId truncated");
    const credentialId = buf.subarray(off, off + credIdLen);
    off += credIdLen;
    const pkRes = cborDecode(buf, off);
    if (!(pkRes.value instanceof Map)) throw new Error("credentialPublicKey not a CBOR map");
    out.aaguid = new Uint8Array(aaguid);
    out.credentialId = new Uint8Array(credentialId);
    out.credentialPublicKey = pkRes.value;
    off = pkRes.next;
  }
  return out;
}

// -----------------------------------------------------------------------------
// COSE_Key (RFC 8152 §7) -> WebCrypto JWK.
// COSE labels we accept:
//   1: kty            (1=OKP, 2=EC2, 3=RSA)
//   3: alg            (-7 ES256, -8 EdDSA, -257 RS256)
//   -1: crv (EC/OKP)
//   -2: x
//   -3: y
//   -1 RSA: n
//   -2 RSA: e
// -----------------------------------------------------------------------------

export interface CoseKey {
  alg: number;
  jwk: JsonWebKey;
  algName: "ES256" | "EdDSA" | "RS256";
}

export function coseKeyToJwk(coseKey: Map<unknown, unknown>): CoseKey {
  const kty = coseKey.get(1);
  const alg = coseKey.get(3);
  if (typeof alg !== "number") throw new Error("COSE: missing alg");
  if (kty === 2) {
    if (alg !== -7) throw new Error("COSE: EC2 with non-ES256 alg unsupported");
    const crv = coseKey.get(-1);
    const x = coseKey.get(-2);
    const y = coseKey.get(-3);
    if (crv !== 1) throw new Error("COSE: EC2 only P-256 (crv=1) supported");
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
      throw new Error("COSE: EC2 missing x/y");
    }
    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      x: b64uEncode(x),
      y: b64uEncode(y),
      ext: true,
    };
    return { alg, jwk, algName: "ES256" };
  }
  if (kty === 1) {
    if (alg !== -8) throw new Error("COSE: OKP with non-EdDSA alg unsupported");
    const crv = coseKey.get(-1);
    const x = coseKey.get(-2);
    if (crv !== 6) throw new Error("COSE: OKP only Ed25519 (crv=6) supported");
    if (!(x instanceof Uint8Array)) throw new Error("COSE: OKP missing x");
    const jwk: JsonWebKey = {
      kty: "OKP",
      crv: "Ed25519",
      x: b64uEncode(x),
      ext: true,
    };
    return { alg, jwk, algName: "EdDSA" };
  }
  if (kty === 3) {
    if (alg !== -257) throw new Error("COSE: RSA with non-RS256 alg unsupported");
    const n = coseKey.get(-1);
    const e = coseKey.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      throw new Error("COSE: RSA missing n/e");
    }
    const jwk: JsonWebKey = {
      kty: "RSA",
      n: b64uEncode(n),
      e: b64uEncode(e),
      ext: true,
    };
    return { alg, jwk, algName: "RS256" };
  }
  throw new Error(`COSE: unsupported kty ${String(kty)}`);
}

// -----------------------------------------------------------------------------
// Client payload schemas (Zod-validated at the boundary)
// -----------------------------------------------------------------------------

export const AttestationResponseSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
  }),
});
export type AttestationResponse = z.infer<typeof AttestationResponseSchema>;

export const AssertionResponseSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().optional(),
  }),
});
export type AssertionResponse = z.infer<typeof AssertionResponseSchema>;

// -----------------------------------------------------------------------------
// Stored credential
// -----------------------------------------------------------------------------

export interface StoredCredential {
  userId: string;
  credentialId: string;
  publicKeyJwk: JsonWebKey;
  algName: "ES256" | "EdDSA" | "RS256";
  signCount: number;
  createdAt: string;
}

export interface CredentialStore {
  byCredId(id: string): StoredCredential | null;
  byUser(userId: string): StoredCredential[];
  put(c: StoredCredential): void;
  bumpSignCount(id: string, next: number): void;
}

export class MemoryCredentialStore implements CredentialStore {
  readonly #byCredId = new Map<string, StoredCredential>();
  readonly #byUser = new Map<string, StoredCredential[]>();
  byCredId(id: string): StoredCredential | null {
    return this.#byCredId.get(id) ?? null;
  }
  byUser(userId: string): StoredCredential[] {
    return [...(this.#byUser.get(userId) ?? [])];
  }
  put(c: StoredCredential): void {
    this.#byCredId.set(c.credentialId, c);
    const list = this.#byUser.get(c.userId) ?? [];
    const without = list.filter((x) => x.credentialId !== c.credentialId);
    without.push(c);
    this.#byUser.set(c.userId, without);
  }
  bumpSignCount(id: string, next: number): void {
    const c = this.#byCredId.get(id);
    if (!c) return;
    c.signCount = next;
  }
}

// -----------------------------------------------------------------------------
// Challenge ledger
// -----------------------------------------------------------------------------

export interface PendingChallenge {
  challenge: string;
  userId: string;
  rpId: string;
  expiresAt: number;
  kind: "registration" | "authentication";
}

export interface ChallengeStore {
  put(c: PendingChallenge): void;
  take(challenge: string): PendingChallenge | null;
}

export class MemoryChallengeStore implements ChallengeStore {
  readonly #m = new Map<string, PendingChallenge>();
  put(c: PendingChallenge): void {
    this.#m.set(c.challenge, c);
  }
  take(challenge: string): PendingChallenge | null {
    const c = this.#m.get(challenge) ?? null;
    if (c) this.#m.delete(challenge);
    if (!c) return null;
    if (c.expiresAt < Date.now()) return null;
    return c;
  }
}

// -----------------------------------------------------------------------------
// Authenticator
// -----------------------------------------------------------------------------

export interface PasskeyAuthenticator {
  beginRegistration(input: { userId: string; rpId: string; ttlMs?: number }): {
    challenge: string;
    rpId: string;
    userId: string;
    expiresAt: string;
  };
  finishRegistration(input: {
    userId: string;
    rpId: string;
    expectedOrigin: string;
    attestation: AttestationResponse;
  }): Promise<{ credentialId: string; algName: "ES256" | "EdDSA" | "RS256" }>;
  beginAuthentication(input: { userId: string; rpId: string; ttlMs?: number }): {
    challenge: string;
    rpId: string;
    userId: string;
    expiresAt: string;
    allowCredentials: { id: string; type: "public-key" }[];
  };
  finishAuthentication(input: {
    userId: string;
    rpId: string;
    expectedOrigin: string;
    assertion: AssertionResponse;
  }): Promise<boolean>;
}

const CHALLENGE_BYTES = 32;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function makeChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES));
  return b64uEncode(bytes);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return new Uint8Array(buf);
}

async function importPublicKey(jwk: JsonWebKey, algName: "ES256" | "EdDSA" | "RS256"): Promise<CryptoKey> {
  if (algName === "ES256") {
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  }
  if (algName === "RS256") {
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

/** ECDSA signatures from WebAuthn are DER-encoded; WebCrypto wants raw r||s. */
function derToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) throw new Error("DER: not a SEQUENCE");
  let off = 2;
  if (der[1]! & 0x80) {
    const lenBytes = der[1]! & 0x7f;
    off = 2 + lenBytes;
  }
  if (der[off] !== 0x02) throw new Error("DER: r not INTEGER");
  let rLen = der[off + 1]!;
  let rStart = off + 2;
  if (der[rStart] === 0x00 && rLen > 32) { rStart += 1; rLen -= 1; }
  const r = der.subarray(rStart, rStart + rLen);
  let sOff = rStart + rLen;
  if (der[sOff] !== 0x02) throw new Error("DER: s not INTEGER");
  let sLen = der[sOff + 1]!;
  let sStart = sOff + 2;
  if (der[sStart] === 0x00 && sLen > 32) { sStart += 1; sLen -= 1; }
  const s = der.subarray(sStart, sStart + sLen);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

async function verifySignature(
  algName: "ES256" | "EdDSA" | "RS256",
  jwk: JsonWebKey,
  sig: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  const key = await importPublicKey(jwk, algName);
  if (algName === "ES256") {
    const raw = derToRaw(sig);
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      raw as unknown as ArrayBuffer,
      data as unknown as ArrayBuffer,
    );
  }
  if (algName === "RS256") {
    return crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      sig as unknown as ArrayBuffer,
      data as unknown as ArrayBuffer,
    );
  }
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    sig as unknown as ArrayBuffer,
    data as unknown as ArrayBuffer,
  );
}

export interface PasskeyAuthenticatorOptions {
  credentials?: CredentialStore;
  challenges?: ChallengeStore;
  /**
   * Attestation verifier seam. Returning false fails the registration. The
   * default trusts `none` and `packed` self formats; production live mode
   * should plug in FIDO MDS3.
   */
  verifyAttestation?: (fmt: string, attStmt: Map<unknown, unknown>) => Promise<boolean>;
}

export function makePasskeyAuthenticator(
  opts: PasskeyAuthenticatorOptions = {},
): PasskeyAuthenticator {
  const credentials = opts.credentials ?? new MemoryCredentialStore();
  const challenges = opts.challenges ?? new MemoryChallengeStore();
  const verifyAttestation =
    opts.verifyAttestation ??
    (async (fmt: string): Promise<boolean> => fmt === "none" || fmt === "packed");

  return {
    beginRegistration({ userId, rpId, ttlMs }): {
      challenge: string;
      rpId: string;
      userId: string;
      expiresAt: string;
    } {
      const challenge = makeChallenge();
      const expiresAt = Date.now() + (ttlMs ?? DEFAULT_TTL_MS);
      challenges.put({ challenge, userId, rpId, expiresAt, kind: "registration" });
      return {
        challenge,
        rpId,
        userId,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },
    async finishRegistration({ userId, rpId, expectedOrigin, attestation }): Promise<{
      credentialId: string;
      algName: "ES256" | "EdDSA" | "RS256";
    }> {
      AttestationResponseSchema.parse(attestation);
      const clientDataBytes = b64uDecode(attestation.response.clientDataJSON);
      const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
        type: string;
        challenge: string;
        origin: string;
      };
      if (clientData.type !== "webauthn.create") {
        throw new Error("clientData.type mismatch");
      }
      if (clientData.origin !== expectedOrigin) {
        throw new Error("clientData.origin mismatch");
      }
      const challenge = challenges.take(clientData.challenge);
      if (!challenge) throw new Error("challenge unknown or expired");
      if (challenge.kind !== "registration") throw new Error("challenge wrong kind");
      if (challenge.userId !== userId) throw new Error("challenge user mismatch");
      if (challenge.rpId !== rpId) throw new Error("challenge rpId mismatch");

      const attObjBytes = b64uDecode(attestation.response.attestationObject);
      const decoded = cborDecode(attObjBytes).value;
      if (!(decoded instanceof Map)) throw new Error("attestationObject not a CBOR map");
      const fmt = decoded.get("fmt");
      const authData = decoded.get("authData");
      const attStmt = decoded.get("attStmt");
      if (typeof fmt !== "string") throw new Error("attestationObject missing fmt");
      if (!(authData instanceof Uint8Array)) throw new Error("attestationObject missing authData");
      if (!(attStmt instanceof Map)) throw new Error("attestationObject missing attStmt");

      const ok = await verifyAttestation(fmt, attStmt);
      if (!ok) throw new Error(`attestation rejected: fmt=${fmt}`);

      const parsed = parseAuthenticatorData(authData);
      if (!parsed.flags.up) throw new Error("UP flag missing");
      if (!parsed.flags.at) throw new Error("AT flag missing");
      if (!parsed.credentialId || !parsed.credentialPublicKey) {
        throw new Error("attested credential data missing");
      }
      const expectedRpIdHash = await sha256(new TextEncoder().encode(rpId));
      if (!eqBytes(parsed.rpIdHash, expectedRpIdHash)) {
        throw new Error("rpIdHash mismatch");
      }

      const cose = coseKeyToJwk(parsed.credentialPublicKey);
      const credentialId = b64uEncode(parsed.credentialId);
      const stored: StoredCredential = {
        userId,
        credentialId,
        publicKeyJwk: cose.jwk,
        algName: cose.algName,
        signCount: parsed.signCount,
        createdAt: new Date().toISOString(),
      };
      credentials.put(stored);
      return { credentialId, algName: cose.algName };
    },
    beginAuthentication({ userId, rpId, ttlMs }): {
      challenge: string;
      rpId: string;
      userId: string;
      expiresAt: string;
      allowCredentials: { id: string; type: "public-key" }[];
    } {
      const challenge = makeChallenge();
      const expiresAt = Date.now() + (ttlMs ?? DEFAULT_TTL_MS);
      challenges.put({ challenge, userId, rpId, expiresAt, kind: "authentication" });
      const list = credentials.byUser(userId);
      return {
        challenge,
        rpId,
        userId,
        expiresAt: new Date(expiresAt).toISOString(),
        allowCredentials: list.map((c) => ({ id: c.credentialId, type: "public-key" as const })),
      };
    },
    async finishAuthentication({ userId, rpId, expectedOrigin, assertion }): Promise<boolean> {
      AssertionResponseSchema.parse(assertion);
      const clientDataBytes = b64uDecode(assertion.response.clientDataJSON);
      const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
        type: string;
        challenge: string;
        origin: string;
      };
      if (clientData.type !== "webauthn.get") return false;
      if (clientData.origin !== expectedOrigin) return false;
      const challenge = challenges.take(clientData.challenge);
      if (!challenge) return false;
      if (challenge.kind !== "authentication") return false;
      if (challenge.userId !== userId) return false;
      if (challenge.rpId !== rpId) return false;

      const cred = credentials.byCredId(assertion.id);
      if (!cred) return false;
      if (cred.userId !== userId) return false;

      const authData = b64uDecode(assertion.response.authenticatorData);
      const parsed = parseAuthenticatorData(authData);
      const expectedRpIdHash = await sha256(new TextEncoder().encode(rpId));
      if (!eqBytes(parsed.rpIdHash, expectedRpIdHash)) return false;
      if (!parsed.flags.up) return false;
      if (parsed.signCount !== 0 && parsed.signCount <= cred.signCount) {
        return false;
      }

      const clientDataHash = await sha256(clientDataBytes);
      const signedBytes = new Uint8Array(authData.length + clientDataHash.length);
      signedBytes.set(authData, 0);
      signedBytes.set(clientDataHash, authData.length);
      const sig = b64uDecode(assertion.response.signature);
      const ok = await verifySignature(cred.algName, cred.publicKeyJwk, sig, signedBytes);
      if (!ok) return false;
      credentials.bumpSignCount(cred.credentialId, parsed.signCount);
      return true;
    },
  };
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i]! ^ b[i]!;
  return r === 0;
}

// -----------------------------------------------------------------------------
// Test fixture builder — produces a deterministic set of bytes that the
// authenticator algorithms accept. Used by tests in this package and by the
// command-grant-passkey bridge tests.
// -----------------------------------------------------------------------------

export interface FixtureRegistration {
  attestation: AttestationResponse;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  credentialId: Uint8Array;
}

export interface FixtureAssertion {
  assertion: AssertionResponse;
}

export async function makeRegistrationFixture(input: {
  rpId: string;
  challenge: string;
  origin: string;
  signCount?: number;
}): Promise<FixtureRegistration> {
  const { rpId, challenge, origin } = input;
  const signCount = input.signCount ?? 0;
  // Use ES256 since WebCrypto exposes ECDSA P-256 everywhere.
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const xBytes = b64uDecode(publicJwk.x!);
  const yBytes = b64uDecode(publicJwk.y!);
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  const aaguid = new Uint8Array(16);

  const coseKey = new Map<number, unknown>();
  coseKey.set(1, 2); // kty EC2
  coseKey.set(3, -7); // alg ES256
  coseKey.set(-1, 1); // crv P-256
  coseKey.set(-2, xBytes);
  coseKey.set(-3, yBytes);
  const coseBytes = cborEncode(coseKey);

  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const flags = 0x01 /* UP */ | 0x04 /* UV */ | 0x40 /* AT */;
  const authData = new Uint8Array(
    37 + 16 + 2 + credentialId.length + coseBytes.length,
  );
  authData.set(rpIdHash, 0);
  authData[32] = flags;
  authData[33] = (signCount >>> 24) & 0xff;
  authData[34] = (signCount >>> 16) & 0xff;
  authData[35] = (signCount >>> 8) & 0xff;
  authData[36] = signCount & 0xff;
  let off = 37;
  authData.set(aaguid, off); off += 16;
  authData[off] = (credentialId.length >>> 8) & 0xff;
  authData[off + 1] = credentialId.length & 0xff;
  off += 2;
  authData.set(credentialId, off); off += credentialId.length;
  authData.set(coseBytes, off);

  const attObjMap = new Map<string, unknown>();
  attObjMap.set("fmt", "none");
  attObjMap.set("attStmt", new Map<string, unknown>());
  attObjMap.set("authData", authData);
  const attObjBytes = cborEncode(attObjMap);

  const clientData = {
    type: "webauthn.create",
    challenge,
    origin,
    crossOrigin: false,
  };
  const clientDataJSONBytes = new TextEncoder().encode(JSON.stringify(clientData));

  return {
    privateJwk,
    publicJwk,
    credentialId,
    attestation: {
      id: b64uEncode(credentialId),
      rawId: b64uEncode(credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64uEncode(clientDataJSONBytes),
        attestationObject: b64uEncode(attObjBytes),
      },
    },
  };
}

export async function makeAssertionFixture(input: {
  rpId: string;
  challenge: string;
  origin: string;
  credentialId: Uint8Array;
  privateJwk: JsonWebKey;
  signCount: number;
}): Promise<FixtureAssertion> {
  const { rpId, challenge, origin, credentialId, privateJwk, signCount } = input;
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const flags = 0x01 /* UP */ | 0x04 /* UV */;
  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = flags;
  authData[33] = (signCount >>> 24) & 0xff;
  authData[34] = (signCount >>> 16) & 0xff;
  authData[35] = (signCount >>> 8) & 0xff;
  authData[36] = signCount & 0xff;

  const clientData = {
    type: "webauthn.get",
    challenge,
    origin,
    crossOrigin: false,
  };
  const clientDataJSONBytes = new TextEncoder().encode(JSON.stringify(clientData));
  const clientDataHash = await sha256(clientDataJSONBytes);
  const signedBytes = new Uint8Array(authData.length + clientDataHash.length);
  signedBytes.set(authData, 0);
  signedBytes.set(clientDataHash, authData.length);

  const privKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const rawSig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privKey,
      signedBytes as unknown as ArrayBuffer,
    ),
  );
  const derSig = rawToDer(rawSig);
  return {
    assertion: {
      id: b64uEncode(credentialId),
      rawId: b64uEncode(credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64uEncode(clientDataJSONBytes),
        authenticatorData: b64uEncode(authData),
        signature: b64uEncode(derSig),
      },
    },
  };
}

function rawToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error("ECDSA raw signature must be 64 bytes");
  const r = raw.subarray(0, 32);
  const s = raw.subarray(32, 64);
  const rDer = encodeInteger(r);
  const sDer = encodeInteger(s);
  const seqLen = rDer.length + sDer.length;
  const out = new Uint8Array(2 + seqLen);
  out[0] = 0x30;
  out[1] = seqLen;
  out.set(rDer, 2);
  out.set(sDer, 2 + rDer.length);
  return out;
}

function encodeInteger(buf: Uint8Array): Uint8Array {
  let off = 0;
  while (off < buf.length - 1 && buf[off] === 0) off++;
  let body = buf.subarray(off);
  if (body[0]! & 0x80) {
    const padded = new Uint8Array(body.length + 1);
    padded.set(body, 1);
    body = padded;
  }
  const out = new Uint8Array(2 + body.length);
  out[0] = 0x02;
  out[1] = body.length;
  out.set(body, 2);
  return out;
}

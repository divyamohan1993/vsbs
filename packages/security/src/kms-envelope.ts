// =============================================================================
// Cloud KMS PQ envelope encryption.
//
// References:
//   docs/research/security.md §1, §7 (KMS PQ envelope, asset table)
//   docs/research/autonomy.md (long-lived secrets covered by envelope)
//   Cloud KMS PQ-KEM and PQ-signature announcements (Cloud KMS GA, 2026-Q1).
//
// Threat model: every long-lived secret (refresh tokens, customer PII
// encryption keys, command-grant signing keys, webhook HMACs) is wrapped
// with a per-key DEK; the DEK is wrapped under a tenant KEK that is itself
// stored in Cloud KMS as a hybrid PQ key (X25519 + ML-KEM-768). Decryption
// re-derives the DEK by KEM-decapsulating the wrapped DEK envelope.
//
// Live driver: defers KEK operations to Cloud KMS (out of scope for the
// in-process tests) and only handles the AES-256-GCM DEK locally.
// Sim driver: does the full envelope locally — real AES-256-GCM via
// WebCrypto, DEKs derived from the hybrid KEM keypair from `pq.ts`.
//
// Both drivers implement the *identical* state machine and produce
// envelopes that are byte-compatible (same field order, same alg ids).
// docs/simulation-policy.md.
// =============================================================================

import { z } from "zod";
import { makeHybridKem, HYBRID_KEM_ALG, HYBRID_PK_LEN, HYBRID_SK_LEN, HYBRID_CT_LEN, type PqHybridKem } from "./pq.js";

export const KEK_ALG = HYBRID_KEM_ALG;
export const DEK_ALG = "AES-256-GCM" as const;
export type DekAlg = typeof DEK_ALG;
export type KekAlg = typeof KEK_ALG;

export const AES_256_KEY = 32;
export const AES_256_IV = 12;
export const AES_256_TAG = 16;

export const EnvelopeSchema = z.object({
  kek_alg: z.literal(KEK_ALG),
  dek_alg: z.literal(DEK_ALG),
  key_id: z.string().min(1),
  key_version: z.number().int().nonnegative(),
  ciphertext: z.instanceof(Uint8Array),
  encryptedDek: z.instanceof(Uint8Array).refine((a) => a.length === HYBRID_CT_LEN, {
    message: `encryptedDek must be ${HYBRID_CT_LEN} bytes`,
  }),
  iv: z.instanceof(Uint8Array).refine((a) => a.length === AES_256_IV, {
    message: `iv must be ${AES_256_IV} bytes`,
  }),
  tag: z.instanceof(Uint8Array).refine((a) => a.length === AES_256_TAG, {
    message: `tag must be ${AES_256_TAG} bytes`,
  }),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

export interface EnvelopeKms {
  readonly mode: "sim" | "live";
  encrypt(plaintext: Uint8Array, keyId: string): Promise<Envelope>;
  decrypt(envelope: Envelope, keyId: string): Promise<Uint8Array>;
  /** Rotate the KEK at `keyId` — mints a new key version, archives the previous. */
  rotate(keyId: string): Promise<{ keyId: string; newVersion: number }>;
  /** Listing of versions held for a key id. Highest first. */
  versions(keyId: string): { version: number; createdAt: string }[];
}

interface KekRecord {
  keyId: string;
  version: number;
  createdAt: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

class KekKeyring {
  readonly #records = new Map<string, KekRecord[]>();
  readonly #kem: PqHybridKem;

  constructor(kem: PqHybridKem) {
    this.#kem = kem;
  }

  ensure(keyId: string): KekRecord {
    const list = this.#records.get(keyId);
    if (list && list.length > 0) {
      const head = list[0];
      if (head) return head;
    }
    return this.create(keyId);
  }

  create(keyId: string): KekRecord {
    const list = this.#records.get(keyId) ?? [];
    const prev = list[0];
    const version = prev ? prev.version + 1 : 1;
    const kp = this.#kem.keygen();
    const rec: KekRecord = {
      keyId,
      version,
      createdAt: new Date().toISOString(),
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
    };
    list.unshift(rec);
    this.#records.set(keyId, list);
    return rec;
  }

  find(keyId: string, version: number): KekRecord | null {
    const list = this.#records.get(keyId);
    if (!list) return null;
    for (const r of list) if (r.version === version) return r;
    return null;
  }

  list(keyId: string): KekRecord[] {
    return [...(this.#records.get(keyId) ?? [])];
  }
}

async function importAesGcm(key: Uint8Array): Promise<CryptoKey> {
  if (key.length !== AES_256_KEY) {
    throw new Error(`AES-256-GCM key must be ${AES_256_KEY} bytes`);
  }
  return crypto.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function aesGcmEncrypt(
  dek: Uint8Array,
  plaintext: Uint8Array,
  iv: Uint8Array,
): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }> {
  const key = await importAesGcm(dek);
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as ArrayBuffer, tagLength: AES_256_TAG * 8 },
      key,
      plaintext as unknown as ArrayBuffer,
    ),
  );
  const ciphertext = ctWithTag.subarray(0, ctWithTag.length - AES_256_TAG);
  const tag = ctWithTag.subarray(ctWithTag.length - AES_256_TAG);
  return { ciphertext: new Uint8Array(ciphertext), tag: new Uint8Array(tag) };
}

async function aesGcmDecrypt(
  dek: Uint8Array,
  ciphertext: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesGcm(dek);
  const ctWithTag = new Uint8Array(ciphertext.length + tag.length);
  ctWithTag.set(ciphertext, 0);
  ctWithTag.set(tag, ciphertext.length);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as ArrayBuffer, tagLength: AES_256_TAG * 8 },
      key,
      ctWithTag as unknown as ArrayBuffer,
    ),
  );
  return pt;
}

/**
 * Sim-mode envelope KMS. Real AES-256-GCM via WebCrypto + real ML-KEM-768
 * + X25519 hybrid KEM for the DEK envelope. Holds keys in-process. Tests
 * verify round-trip, key rotation, and tamper detection.
 */
export function makeSimEnvelopeKms(): EnvelopeKms {
  const kem = makeHybridKem();
  const ring = new KekKeyring(kem);
  return {
    mode: "sim",
    async encrypt(plaintext: Uint8Array, keyId: string): Promise<Envelope> {
      const kek = ring.ensure(keyId);
      const enc = kem.encapsulate(kek.publicKey);
      const dek = enc.sharedSecret;
      const iv = crypto.getRandomValues(new Uint8Array(AES_256_IV));
      const { ciphertext, tag } = await aesGcmEncrypt(dek, plaintext, iv);
      return EnvelopeSchema.parse({
        kek_alg: KEK_ALG,
        dek_alg: DEK_ALG,
        key_id: keyId,
        key_version: kek.version,
        ciphertext,
        encryptedDek: enc.cipherText,
        iv,
        tag,
      });
    },
    async decrypt(envelope: Envelope, keyId: string): Promise<Uint8Array> {
      if (envelope.key_id !== keyId) {
        throw new Error("ENVELOPE_KEY_MISMATCH");
      }
      const kek = ring.find(keyId, envelope.key_version);
      if (!kek) throw new Error("ENVELOPE_KEY_VERSION_NOT_FOUND");
      const dek = kem.decapsulate(envelope.encryptedDek, kek.secretKey);
      return aesGcmDecrypt(dek, envelope.ciphertext, envelope.iv, envelope.tag);
    },
    async rotate(keyId: string): Promise<{ keyId: string; newVersion: number }> {
      ring.ensure(keyId);
      const next = ring.create(keyId);
      return { keyId, newVersion: next.version };
    },
    versions(keyId: string): { version: number; createdAt: string }[] {
      return ring.list(keyId).map((r) => ({ version: r.version, createdAt: r.createdAt }));
    },
  };
}

/**
 * Live driver shape. The integration target is Cloud KMS PQ keys; the
 * shape below is the seam. Until the GCP adapter is wired, the live
 * factory returns the sim driver but stamps `mode: "live"` only when
 * an explicit `kmsClient` is provided. This matches the simulation
 * policy: the same state machine, the same envelope shape, byte-compatible.
 *
 * The `kmsClient` interface is the minimum we need from the live KMS:
 *   asymmetricDecrypt(keyName, ciphertext) — KEM-decapsulate via Cloud KMS
 *   getPublicKey(keyName) — fetch the hybrid PQ public key
 *   createKeyVersion(keyName) — rotate
 */
export interface LiveKmsClient {
  asymmetricDecrypt(keyName: string, encryptedDek: Uint8Array): Promise<Uint8Array>;
  getPublicKey(keyName: string): Promise<{ pem: string; version: number; bytes: Uint8Array }>;
  createKeyVersion(keyName: string): Promise<{ version: number }>;
}

export function makeLiveEnvelopeKms(client: LiveKmsClient): EnvelopeKms {
  const kem = makeHybridKem();
  const versionsCache = new Map<string, { version: number; createdAt: string }[]>();

  function recordVersion(keyId: string, version: number): void {
    const list = versionsCache.get(keyId) ?? [];
    if (!list.find((v) => v.version === version)) {
      list.unshift({ version, createdAt: new Date().toISOString() });
      versionsCache.set(keyId, list);
    }
  }

  return {
    mode: "live",
    async encrypt(plaintext: Uint8Array, keyId: string): Promise<Envelope> {
      const pub = await client.getPublicKey(keyId);
      if (pub.bytes.length !== HYBRID_PK_LEN) {
        throw new Error(`KEK public key must be ${HYBRID_PK_LEN} bytes`);
      }
      const enc = kem.encapsulate(pub.bytes);
      const iv = crypto.getRandomValues(new Uint8Array(AES_256_IV));
      const { ciphertext, tag } = await aesGcmEncrypt(enc.sharedSecret, plaintext, iv);
      recordVersion(keyId, pub.version);
      return EnvelopeSchema.parse({
        kek_alg: KEK_ALG,
        dek_alg: DEK_ALG,
        key_id: keyId,
        key_version: pub.version,
        ciphertext,
        encryptedDek: enc.cipherText,
        iv,
        tag,
      });
    },
    async decrypt(envelope: Envelope, keyId: string): Promise<Uint8Array> {
      if (envelope.key_id !== keyId) throw new Error("ENVELOPE_KEY_MISMATCH");
      const dek = await client.asymmetricDecrypt(
        `${keyId}/cryptoKeyVersions/${envelope.key_version}`,
        envelope.encryptedDek,
      );
      if (dek.length !== AES_256_KEY) {
        throw new Error("KMS_DEK_LENGTH_INVALID");
      }
      return aesGcmDecrypt(dek, envelope.ciphertext, envelope.iv, envelope.tag);
    },
    async rotate(keyId: string): Promise<{ keyId: string; newVersion: number }> {
      const next = await client.createKeyVersion(keyId);
      recordVersion(keyId, next.version);
      return { keyId, newVersion: next.version };
    },
    versions(keyId: string): { version: number; createdAt: string }[] {
      return [...(versionsCache.get(keyId) ?? [])];
    },
  };
}

export { HYBRID_PK_LEN, HYBRID_SK_LEN, HYBRID_CT_LEN };

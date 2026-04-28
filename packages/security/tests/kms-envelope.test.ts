import { describe, it, expect } from "vitest";
import { makeSimEnvelopeKms, KEK_ALG, DEK_ALG } from "../src/kms-envelope.js";

const PT = new TextEncoder().encode(
  JSON.stringify({ vin: "1HGCM82633A004352", phone: "+919876543210" }),
);

describe("EnvelopeKms — sim driver", () => {
  it("round-trips encrypt/decrypt", async () => {
    const kms = makeSimEnvelopeKms();
    const env = await kms.encrypt(PT, "vsbs/keys/customer-pii/v1");
    expect(env.kek_alg).toBe(KEK_ALG);
    expect(env.dek_alg).toBe(DEK_ALG);
    const pt = await kms.decrypt(env, "vsbs/keys/customer-pii/v1");
    expect(new TextDecoder().decode(pt)).toBe(new TextDecoder().decode(PT));
  });

  it("rotates a key version and continues to decrypt prior ciphertexts", async () => {
    const kms = makeSimEnvelopeKms();
    const keyId = "vsbs/keys/refresh-tokens";
    const env1 = await kms.encrypt(PT, keyId);
    expect(env1.key_version).toBe(1);
    const r = await kms.rotate(keyId);
    expect(r.newVersion).toBe(2);
    const env2 = await kms.encrypt(PT, keyId);
    expect(env2.key_version).toBe(2);
    const pt1 = await kms.decrypt(env1, keyId);
    const pt2 = await kms.decrypt(env2, keyId);
    expect(new TextDecoder().decode(pt1)).toBe(new TextDecoder().decode(PT));
    expect(new TextDecoder().decode(pt2)).toBe(new TextDecoder().decode(PT));
  });

  it("decryption fails on tag tamper (AES-GCM auth)", async () => {
    const kms = makeSimEnvelopeKms();
    const env = await kms.encrypt(PT, "vsbs/keys/abc");
    env.tag[0] = (env.tag[0]! ^ 0xff) & 0xff;
    await expect(kms.decrypt(env, "vsbs/keys/abc")).rejects.toBeTruthy();
  });

  it("decryption fails on key id mismatch", async () => {
    const kms = makeSimEnvelopeKms();
    const env = await kms.encrypt(PT, "vsbs/keys/aaa");
    await expect(kms.decrypt(env, "vsbs/keys/bbb")).rejects.toThrow(/MISMATCH/);
  });

  it("listing versions reports rotation history", async () => {
    const kms = makeSimEnvelopeKms();
    const keyId = "vsbs/keys/history";
    await kms.encrypt(PT, keyId);
    await kms.rotate(keyId);
    await kms.rotate(keyId);
    const list = kms.versions(keyId);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0]!.version).toBeGreaterThanOrEqual(list[1]!.version);
  });
});

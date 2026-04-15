import { describe, it, expect } from "vitest";
import {
  canonicalize,
  canonicalGrantBytes,
  makeSimGrantVerifier,
  simSignOwner,
  appendAuthority,
  actionPayloadHash,
  witnessSign,
  buildRevocationAction,
} from "./commandgrant-lifecycle.js";
import { CommandGrantSchema, type CommandGrant, type AutonomyAction } from "./autonomy.js";

const baseTemplate = {
  grantId: "11111111-1111-4111-8111-111111111111",
  vehicleId: "veh-1",
  granteeSvcCenterId: "svc-1",
  tier: "A-AVP" as const,
  scopes: ["drive-to-bay" as const, "diagnose" as const],
  notBefore: "2026-04-15T10:00:00.000Z",
  notAfter: "2026-04-15T12:00:00.000Z",
  geofence: { lat: 48.78, lng: 9.18, radiusMeters: 400 },
  maxAutoPayInr: 5000,
  mustNotify: ["start" as const, "any_write" as const, "finish" as const],
  ownerSigAlg: "ed25519" as const,
};

async function mintGrant(): Promise<CommandGrant> {
  const sig = await simSignOwner(baseTemplate);
  const parsed = CommandGrantSchema.parse({
    ...baseTemplate,
    ownerSignatureB64: sig,
    witnessSignaturesB64: {},
  });
  return parsed;
}

describe("canonicalize", () => {
  it("is stable regardless of key order", () => {
    const a = canonicalize({ b: 1, a: 2, c: [3, 2, 1] });
    const b = canonicalize({ c: [3, 2, 1], a: 2, b: 1 });
    expect(a).toEqual(b);
  });

  it("omits undefined but keeps null", () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe("canonicalGrantBytes", () => {
  it("produces identical bytes for scope order permutations", () => {
    const a = canonicalGrantBytes(baseTemplate);
    const b = canonicalGrantBytes({
      ...baseTemplate,
      scopes: ["diagnose" as const, "drive-to-bay" as const],
    });
    expect(new TextDecoder().decode(a)).toBe(new TextDecoder().decode(b));
  });
});

describe("sim owner signature", () => {
  it("roundtrips through the sim verifier", async () => {
    const grant = await mintGrant();
    const v = makeSimGrantVerifier();
    expect(await v.verifyOwnerSignature(grant, null)).toBe(true);
  });

  it("rejects a tampered grant", async () => {
    const grant = await mintGrant();
    const tampered: CommandGrant = { ...grant, maxAutoPayInr: grant.maxAutoPayInr + 1 };
    const v = makeSimGrantVerifier();
    expect(await v.verifyOwnerSignature(tampered, null)).toBe(false);
  });
});

describe("witnessSign", () => {
  it("adds a witness signature without changing grant identity", async () => {
    const grant = await mintGrant();
    const { mergedGrant, signatureB64 } = await witnessSign(grant, "vsbs-concierge");
    expect(mergedGrant.grantId).toBe(grant.grantId);
    expect(mergedGrant.witnessSignaturesB64["vsbs-concierge"]).toBe(signatureB64);
  });
});

describe("authority chain", () => {
  it("links actions with prevChainHash === previous chainHash", async () => {
    const grantId = baseTemplate.grantId;
    const ts = "2026-04-15T10:05:00.000Z";
    const a1 = {
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      grantId,
      timestamp: ts,
      kind: "grant-accepted" as const,
      payloadHash: await actionPayloadHash({
        actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        grantId,
        timestamp: ts,
        kind: "grant-accepted",
      }),
    };
    const linked1 = await appendAuthority(null, a1);
    expect(linked1.prevChainHash).toBe("0".repeat(64));

    const a2 = {
      actionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      grantId,
      timestamp: "2026-04-15T10:06:00.000Z",
      kind: "move-start" as const,
      payloadHash: await actionPayloadHash({
        actionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        grantId,
        timestamp: "2026-04-15T10:06:00.000Z",
        kind: "move-start",
      }),
    };
    const linked2 = await appendAuthority(linked1, a2);
    expect(linked2.prevChainHash).toBe(linked1.chainHash);
    expect(linked2.chainHash).not.toBe(linked1.chainHash);
  });

  it("same payload after same prev yields same chain hash (determinism)", async () => {
    const grantId = baseTemplate.grantId;
    const payload = await actionPayloadHash({
      actionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      grantId,
      timestamp: "2026-04-15T10:07:00.000Z",
      kind: "grant-accepted",
    });
    const base: Omit<AutonomyAction, "chainHash" | "prevChainHash"> = {
      actionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      grantId,
      timestamp: "2026-04-15T10:07:00.000Z",
      kind: "grant-accepted",
      payloadHash: payload,
    };
    const a = await appendAuthority(null, base);
    const b = await appendAuthority(null, base);
    expect(a.chainHash).toBe(b.chainHash);
  });
});

describe("buildRevocationAction", () => {
  it("emits a grant-revoked action with a payload hash", async () => {
    const rev = await buildRevocationAction(baseTemplate.grantId, "owner changed mind");
    expect(rev.kind).toBe("grant-revoked");
    expect(rev.payloadHash).toHaveLength(64);
  });
});

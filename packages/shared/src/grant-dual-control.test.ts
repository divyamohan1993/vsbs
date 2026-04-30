import { describe, it, expect } from "vitest";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import {
  DualControlPolicySchema,
  assembleDualControlGrant,
  recordOffPlatformAudit,
  InMemoryOffPlatformSink,
  NotConfiguredOffPlatformSink,
  type DualControlKeyResolver,
  type DualControlPublicKey,
  type DualControlSignature,
  type DualControlRole,
} from "./grant-dual-control.js";
import { CommandGrantSchema, type CommandGrant, type AutonomyAction } from "./autonomy.js";
import {
  canonicalGrantBytes,
  simSignOwner,
  appendAuthority,
  actionPayloadHash,
} from "./commandgrant-lifecycle.js";

const baseTemplate = {
  grantId: "44444444-4444-4444-8444-444444444444",
  vehicleId: "veh-dc-1",
  granteeSvcCenterId: "svc-1",
  tier: "A-AVP" as const,
  scopes: ["drive-to-bay" as const],
  notBefore: "2026-04-15T10:00:00.000Z",
  notAfter: "2026-04-15T12:00:00.000Z",
  geofence: { lat: 48.78, lng: 9.18, radiusMeters: 400 },
  maxAutoPayInr: 5000,
  mustNotify: ["start" as const],
  ownerSigAlg: "ed25519" as const,
};

async function mintGrant(): Promise<CommandGrant> {
  const sig = await simSignOwner(baseTemplate);
  return CommandGrantSchema.parse({ ...baseTemplate, ownerSignatureB64: sig, witnessSignaturesB64: {} });
}

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

interface SigningKey {
  role: DualControlRole;
  keyId: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

function makeKey(role: DualControlRole, keyId: string): SigningKey {
  const kp = ml_dsa65.keygen();
  return {
    role,
    keyId,
    publicKey: new Uint8Array(kp.publicKey),
    secretKey: new Uint8Array(kp.secretKey),
  };
}

function makeResolver(keys: SigningKey[]): DualControlKeyResolver {
  return (role, keyId): DualControlPublicKey | undefined => {
    const k = keys.find((x) => x.role === role && x.keyId === keyId);
    if (!k) return undefined;
    return { role: k.role, keyId: k.keyId, publicKey: k.publicKey };
  };
}

function signGrant(key: SigningKey, grant: CommandGrant, signedAt: string): DualControlSignature {
  const bytes = canonicalGrantBytes(grant);
  const sig = ml_dsa65.sign(bytes, key.secretKey);
  return {
    role: key.role,
    keyId: key.keyId,
    signedAt,
    sigB64: b64Encode(new Uint8Array(sig)),
    alg: "ml-dsa-65",
  };
}

describe("DualControlPolicySchema", () => {
  it("defaults are sane", () => {
    const p = DualControlPolicySchema.parse({});
    expect(p.requiredSigners).toBe(2);
    expect(p.allowedRoleIds).toContain("owner-passkey");
    expect(p.mandatoryRoleIds).toContain("owner-passkey");
    expect(p.maxAgeBetweenSignaturesMs).toBe(60_000);
  });

  it("rejects requiredSigners > allowedRoleIds count", () => {
    expect(() =>
      DualControlPolicySchema.parse({
        requiredSigners: 3,
        allowedRoleIds: ["owner-passkey", "ops-witness"],
      }),
    ).toThrow();
  });
});

describe("assembleDualControlGrant", () => {
  it("verifies m-of-n with default 2-of-3 policy", async () => {
    const grant = await mintGrant();
    const ownerKey = makeKey("owner-passkey", "kp-owner");
    const opsKey = makeKey("ops-witness", "kp-ops");
    const resolver = makeResolver([ownerKey, opsKey]);
    const policy = DualControlPolicySchema.parse({});
    const t0 = "2026-04-15T10:30:00.000Z";
    const t1 = "2026-04-15T10:30:10.000Z";
    const result = assembleDualControlGrant(
      grant,
      policy,
      [signGrant(ownerKey, grant, t0), signGrant(opsKey, grant, t1)],
      resolver,
    );
    expect(result.kind).toBe("verified");
    if (result.kind === "verified") {
      expect(result.verifiedSigners.map((s) => s.role).sort()).toEqual(["ops-witness", "owner-passkey"]);
    }
  });

  it("rejects when mandatory owner-passkey is absent", async () => {
    const grant = await mintGrant();
    const opsKey = makeKey("ops-witness", "kp-ops");
    const regKey = makeKey("regulator-witness", "kp-reg");
    const resolver = makeResolver([opsKey, regKey]);
    const policy = DualControlPolicySchema.parse({});
    const t0 = "2026-04-15T10:30:00.000Z";
    const t1 = "2026-04-15T10:30:10.000Z";
    const result = assembleDualControlGrant(
      grant,
      policy,
      [signGrant(opsKey, grant, t0), signGrant(regKey, grant, t1)],
      resolver,
    );
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reasons.some((r) => r.includes("owner-passkey"))).toBe(true);
    }
  });

  it("rejects when signature window exceeds policy", async () => {
    const grant = await mintGrant();
    const ownerKey = makeKey("owner-passkey", "kp-owner");
    const opsKey = makeKey("ops-witness", "kp-ops");
    const resolver = makeResolver([ownerKey, opsKey]);
    const policy = DualControlPolicySchema.parse({ maxAgeBetweenSignaturesMs: 5_000 });
    const t0 = "2026-04-15T10:30:00.000Z";
    const t1 = "2026-04-15T10:30:10.000Z"; // 10s gap > 5s window
    const result = assembleDualControlGrant(
      grant,
      policy,
      [signGrant(ownerKey, grant, t0), signGrant(opsKey, grant, t1)],
      resolver,
    );
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reasons.some((r) => r.includes("signature window"))).toBe(true);
    }
  });

  it("rejects duplicate roles", async () => {
    const grant = await mintGrant();
    const ownerKey1 = makeKey("owner-passkey", "kp-o1");
    const ownerKey2 = makeKey("owner-passkey", "kp-o2");
    const resolver = makeResolver([ownerKey1, ownerKey2]);
    const policy = DualControlPolicySchema.parse({});
    const t0 = "2026-04-15T10:30:00.000Z";
    const t1 = "2026-04-15T10:30:01.000Z";
    const result = assembleDualControlGrant(
      grant,
      policy,
      [signGrant(ownerKey1, grant, t0), signGrant(ownerKey2, grant, t1)],
      resolver,
    );
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reasons.some((r) => r.includes("duplicate role"))).toBe(true);
    }
  });

  it("rejects when fewer signatures than requiredSigners verify", async () => {
    const grant = await mintGrant();
    const ownerKey = makeKey("owner-passkey", "kp-owner");
    const resolver = makeResolver([ownerKey]);
    const policy = DualControlPolicySchema.parse({});
    const result = assembleDualControlGrant(
      grant,
      policy,
      [signGrant(ownerKey, grant, "2026-04-15T10:30:00.000Z")],
      resolver,
    );
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reasons.some((r) => r.includes("quorum"))).toBe(true);
    }
  });

  it("rejects bogus signatures even if quorum count is met", async () => {
    const grant = await mintGrant();
    const ownerKey = makeKey("owner-passkey", "kp-owner");
    const opsKey = makeKey("ops-witness", "kp-ops");
    const resolver = makeResolver([ownerKey, opsKey]);
    const policy = DualControlPolicySchema.parse({});
    // Sign owner correctly. Ops-witness signs bytes from a *different* grant
    // (different vehicleId), so the signature will not verify against `grant`.
    const otherGrant = await (async () => {
      const tmpl = { ...baseTemplate, vehicleId: "veh-other-2" };
      const sig = await simSignOwner(tmpl);
      return CommandGrantSchema.parse({ ...tmpl, ownerSignatureB64: sig, witnessSignaturesB64: {} });
    })();
    const t0 = "2026-04-15T10:30:00.000Z";
    const t1 = "2026-04-15T10:30:01.000Z";
    const result = assembleDualControlGrant(
      grant,
      policy,
      [signGrant(ownerKey, grant, t0), signGrant(opsKey, otherGrant, t1)],
      resolver,
    );
    expect(result.kind).toBe("rejected");
  });
});

describe("OffPlatformAuditSink", () => {
  it("InMemoryOffPlatformSink round trips", async () => {
    const sink = new InMemoryOffPlatformSink();
    const action: AutonomyAction = await appendAuthority(null, {
      actionId: "55555555-5555-4555-8555-555555555555",
      grantId: baseTemplate.grantId,
      timestamp: "2026-04-15T10:31:00.000Z",
      kind: "grant-accepted",
      payloadHash: await actionPayloadHash({
        actionId: "55555555-5555-4555-8555-555555555555",
        grantId: baseTemplate.grantId,
        timestamp: "2026-04-15T10:31:00.000Z",
        kind: "grant-accepted",
      }),
    });
    const receipt = await recordOffPlatformAudit(sink, action, "test-suite");
    expect(receipt.externalId).toBe("mem-1");
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]!.entry.action.kind).toBe("grant-accepted");
  });

  it("NotConfiguredOffPlatformSink throws clearly", async () => {
    const sink = new NotConfiguredOffPlatformSink();
    const action: AutonomyAction = await appendAuthority(null, {
      actionId: "66666666-6666-4666-8666-666666666666",
      grantId: baseTemplate.grantId,
      timestamp: "2026-04-15T10:31:00.000Z",
      kind: "grant-revoked",
      payloadHash: await actionPayloadHash({
        actionId: "66666666-6666-4666-8666-666666666666",
        grantId: baseTemplate.grantId,
        timestamp: "2026-04-15T10:31:00.000Z",
        kind: "grant-revoked",
      }),
    });
    await expect(recordOffPlatformAudit(sink, action, "test")).rejects.toThrow(/not configured/i);
  });
});

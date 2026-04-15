import { describe, it, expect } from "vitest";
import { MercedesBoschAvpAdapter } from "./mercedes-bosch.js";
import { MemoryGrantChainStore } from "../grant-chain.js";
import { CommandGrantSchema, type CommandGrant } from "@vsbs/shared";
import { simSignOwner } from "@vsbs/shared/commandgrant-lifecycle";

async function mintGrant(): Promise<CommandGrant> {
  const template = {
    grantId: "22222222-2222-4222-8222-222222222222",
    vehicleId: "veh-avp-1",
    granteeSvcCenterId: "svc-stuttgart",
    tier: "A-AVP" as const,
    scopes: ["drive-to-bay" as const, "diagnose" as const],
    notBefore: "2026-04-15T10:00:00.000Z",
    notAfter: "2026-04-15T12:00:00.000Z",
    geofence: { lat: 48.78, lng: 9.18, radiusMeters: 400 },
    maxAutoPayInr: 5000,
    mustNotify: ["start" as const, "any_write" as const, "finish" as const],
    ownerSigAlg: "ed25519" as const,
  };
  const sig = await simSignOwner(template);
  return CommandGrantSchema.parse({ ...template, ownerSignatureB64: sig, witnessSignaturesB64: {} });
}

describe("MercedesBoschAvpAdapter sim driver", () => {
  it("walks mint -> accept -> perform -> revoke emitting linked chain entries", async () => {
    const store = new MemoryGrantChainStore();
    const adapter = new MercedesBoschAvpAdapter({ mode: "sim", store });

    const auth = await adapter.authenticate();
    expect(auth.sessionId).toMatch(/^ipp_sim_/);

    const grant = await mintGrant();
    const accept = await adapter.acceptGrant(grant);
    expect(accept.kind).toBe("grant-accepted");

    const driveResult = await adapter.performScope({ grantId: grant.grantId, scope: "drive-to-bay" });
    expect(driveResult.actions).toHaveLength(2);
    expect(driveResult.state.stage).toBe("parked");

    const diagResult = await adapter.performScope({ grantId: grant.grantId, scope: "diagnose" });
    expect(diagResult.actions[0]!.kind).toBe("diagnose-start");
    expect(diagResult.actions[1]!.kind).toBe("diagnose-finish");

    const revoke = await adapter.revokeGrant(grant.grantId, "service complete");
    expect(revoke.kind).toBe("grant-revoked");

    const chain = store.listActions(grant.grantId);
    expect(chain.length).toBeGreaterThanOrEqual(4);
    // Chain linkage: each prevChainHash must equal the previous entry's chainHash.
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.prevChainHash).toBe(chain[i - 1]!.chainHash);
    }
    // First entry's prev must be zero-hash.
    expect(chain[0]!.prevChainHash).toBe("0".repeat(64));
  });

  it("live mode without env vars throws fast", () => {
    const store = new MemoryGrantChainStore();
    expect(() => new MercedesBoschAvpAdapter({ mode: "live", store })).toThrow(/MERCEDES_IPP/);
  });

  it("readState returns awaiting for unknown vehicle", async () => {
    const adapter = new MercedesBoschAvpAdapter({ mode: "sim", store: new MemoryGrantChainStore() });
    const st = await adapter.readState("unknown-veh");
    expect(st.stage).toBe("awaiting");
  });
});

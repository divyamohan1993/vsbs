

import { verifyAuthorityChain } from "../src/lib/grant-signing";
import { appendAuthority, actionPayloadHash } from "@vsbs/shared";
import type { AutonomyAction } from "@vsbs/shared";

describe("verifyAuthorityChain", () => {
  it("accepts an empty chain", () => {
    expect(verifyAuthorityChain([])).toBe(true);
  });

  it("accepts a real append-only chain built with shared helpers", async () => {
    const grantId = "11111111-1111-4111-8111-111111111111";
    const a1 = await appendAuthority(null, {
      actionId: "22222222-2222-4222-8222-222222222222",
      grantId,
      timestamp: "2026-04-15T10:00:00.000Z",
      kind: "grant-accepted",
      payloadHash: await actionPayloadHash({
        actionId: "22222222-2222-4222-8222-222222222222",
        grantId,
        timestamp: "2026-04-15T10:00:00.000Z",
        kind: "grant-accepted",
      }),
    });
    const a2 = await appendAuthority(a1, {
      actionId: "33333333-3333-4333-8333-333333333333",
      grantId,
      timestamp: "2026-04-15T10:01:00.000Z",
      kind: "move-start",
      payloadHash: await actionPayloadHash({
        actionId: "33333333-3333-4333-8333-333333333333",
        grantId,
        timestamp: "2026-04-15T10:01:00.000Z",
        kind: "move-start",
      }),
    });
    expect(verifyAuthorityChain([a1, a2])).toBe(true);
  });

  it("rejects a chain where prevChainHash has been tampered with", async () => {
    const grantId = "11111111-1111-4111-8111-111111111111";
    const a1 = await appendAuthority(null, {
      actionId: "22222222-2222-4222-8222-222222222222",
      grantId,
      timestamp: "2026-04-15T10:00:00.000Z",
      kind: "grant-accepted",
      payloadHash: await actionPayloadHash({
        actionId: "22222222-2222-4222-8222-222222222222",
        grantId,
        timestamp: "2026-04-15T10:00:00.000Z",
        kind: "grant-accepted",
      }),
    });
    const a2 = await appendAuthority(a1, {
      actionId: "33333333-3333-4333-8333-333333333333",
      grantId,
      timestamp: "2026-04-15T10:01:00.000Z",
      kind: "move-start",
      payloadHash: await actionPayloadHash({
        actionId: "33333333-3333-4333-8333-333333333333",
        grantId,
        timestamp: "2026-04-15T10:01:00.000Z",
        kind: "move-start",
      }),
    });
    const tampered: AutonomyAction = { ...a2, prevChainHash: "0".repeat(63) + "f" };
    expect(verifyAuthorityChain([a1, tampered])).toBe(false);
  });

  it("rejects a chain whose first prevChainHash is not zero", () => {
    const fake: AutonomyAction = {
      actionId: "44444444-4444-4444-8444-444444444444",
      grantId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-04-15T10:00:00.000Z",
      kind: "grant-accepted",
      payloadHash: "a".repeat(64),
      prevChainHash: "deadbeef".padEnd(64, "0"),
      chainHash: "b".repeat(64),
    };
    expect(verifyAuthorityChain([fake])).toBe(false);
  });
});

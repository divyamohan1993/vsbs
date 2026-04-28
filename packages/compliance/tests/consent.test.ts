import { describe, expect, it } from "vitest";

import {
  InMemoryConsentManager,
  DEFAULT_PURPOSE_REGISTRY,
  ConsentNotRevocableError,
  buildEvidenceHash,
  latestVersions,
} from "../src/consent.js";

describe("InMemoryConsentManager", () => {
  it("records a grant with a uuid id and ISO timestamp", async () => {
    const m = new InMemoryConsentManager();
    const ev = await buildEvidenceHash(
      DEFAULT_PURPOSE_REGISTRY["diagnostic-telemetry"],
      "en",
      "We collect diagnostic data to fix your vehicle.",
    );
    const row = await m.record({
      userId: "user-1",
      purpose: "diagnostic-telemetry",
      version: "1.0.0",
      evidenceHash: ev,
      source: "web",
      ip_hash: "abc",
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.action).toBe("grant");
    expect(row.purpose).toBe("diagnostic-telemetry");
    expect(row.evidenceHash).toBe(ev);
    expect(new Date(row.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("grant -> revoke -> re-grant produces three rows and the latest is granted", async () => {
    const m = new InMemoryConsentManager();
    const ev = await buildEvidenceHash(DEFAULT_PURPOSE_REGISTRY.marketing, "en", "Marketing optional.");
    await m.record({ userId: "u", purpose: "marketing", version: "1.0.0", evidenceHash: ev, source: "web" });
    await m.revoke({ userId: "u", purpose: "marketing", reason: "no thanks" });
    await m.record({ userId: "u", purpose: "marketing", version: "1.0.0", evidenceHash: ev, source: "web" });
    const log = await m.getConsentLog("u");
    expect(log).toHaveLength(3);
    const eff = await m.effectiveConsents("u");
    expect(eff.find((e) => e.purpose === "marketing")?.granted).toBe(true);
  });

  it("refuses to revoke a non-revocable purpose", async () => {
    const m = new InMemoryConsentManager();
    await expect(m.revoke({ userId: "u", purpose: "service-fulfilment" })).rejects.toBeInstanceOf(
      ConsentNotRevocableError,
    );
  });

  it("flags stale consent when notice version moves forward", async () => {
    const m = new InMemoryConsentManager();
    const ev = await buildEvidenceHash(DEFAULT_PURPOSE_REGISTRY.marketing, "en", "Marketing optional.");
    await m.record({ userId: "u", purpose: "marketing", version: "0.9.0", evidenceHash: ev, source: "web" });
    const eff = await m.effectiveConsents("u");
    const m1 = eff.find((e) => e.purpose === "marketing");
    expect(m1?.granted).toBe(true);
    expect(m1?.staleAgainst).toBe("1.0.0");
    const need = await m.requiresReConsent("u", latestVersions());
    expect(need).toContain("marketing");
  });

  it("hasEffective returns true for service-fulfilment by default (contract basis)", async () => {
    const m = new InMemoryConsentManager();
    expect(await m.hasEffective("never-recorded", "service-fulfilment")).toBe(true);
    expect(await m.hasEffective("never-recorded", "marketing")).toBe(false);
  });

  it("evidence hash is deterministic for the same shown text", async () => {
    const a = await buildEvidenceHash(DEFAULT_PURPOSE_REGISTRY.marketing, "en", "Marketing optional.");
    const b = await buildEvidenceHash(DEFAULT_PURPOSE_REGISTRY.marketing, "en", "Marketing optional.");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("latestVersions covers every purpose in the enum", () => {
    const versions = latestVersions();
    for (const p of Object.keys(DEFAULT_PURPOSE_REGISTRY)) {
      expect(versions[p as keyof typeof versions]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

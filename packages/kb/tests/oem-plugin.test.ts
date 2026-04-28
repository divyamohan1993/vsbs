import { describe, it, expect } from "vitest";
import {
  OemPluginRegistry,
  EmptyOemProvider,
  GenericNhtsaTsbProvider,
} from "../src/oem-plugin.js";

describe("OemPluginRegistry — tenant isolation + EULA gate", () => {
  it("refuses to register a provider whose EULA has not been accepted", () => {
    const reg = new OemPluginRegistry();
    const provider = {
      id: "broken:test",
      tenantId: "tenant-a",
      oem: "Acme",
      name: "Acme manuals",
      eulaAccepted: false,
      async fetch() {
        return [];
      },
    };
    expect(() => reg.register(provider)).toThrow(/EULA/);
  });

  it("returns null when the requesting tenant has not registered a provider", async () => {
    const reg = new OemPluginRegistry();
    reg.register(new EmptyOemProvider({ tenantId: "tenant-a", oem: "Honda" }));
    expect(reg.get("tenant-b", "Honda")).toBeNull();
    const hits = await reg.fetch("tenant-b", "Honda", "anything");
    expect(hits).toEqual([]);
  });

  it("returns chunks from the matching tenant's provider only", async () => {
    const reg = new OemPluginRegistry();
    reg.register(new GenericNhtsaTsbProvider({ tenantId: "tenant-a", oem: "Honda" }));
    const hits = await reg.fetch("tenant-a", "Honda", "Civic brake squeal");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((c) => c.metadata.tenantId === "tenant-a")).toBe(true);
  });

  it("the empty stub provider always returns no chunks", async () => {
    const reg = new OemPluginRegistry();
    reg.register(new EmptyOemProvider({ tenantId: "t1", oem: "X" }));
    expect(await reg.fetch("t1", "X", "anything")).toEqual([]);
  });

  it("lists providers per tenant", () => {
    const reg = new OemPluginRegistry();
    reg.register(new EmptyOemProvider({ tenantId: "t1", oem: "Honda" }));
    reg.register(new EmptyOemProvider({ tenantId: "t1", oem: "Toyota" }));
    reg.register(new EmptyOemProvider({ tenantId: "t2", oem: "Honda" }));
    expect(reg.list("t1").length).toBe(2);
    expect(reg.list("t2").length).toBe(1);
  });
});

describe("GenericNhtsaTsbProvider", () => {
  it("matches by model name", async () => {
    const provider = new GenericNhtsaTsbProvider({ tenantId: "t1", oem: "Honda" });
    const chunks = await provider.fetch("Civic", { tenantId: "t1", oem: "Honda", eulaAccepted: true });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.metadata.oem === "Honda")).toBe(true);
  });

  it("matches by DTC code mentioned in the TSB body", async () => {
    const provider = new GenericNhtsaTsbProvider({ tenantId: "t1", oem: "Toyota" });
    const chunks = await provider.fetch("P0420", { tenantId: "t1", oem: "Toyota", eulaAccepted: true });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("never returns chunks for an unrelated OEM", async () => {
    const provider = new GenericNhtsaTsbProvider({ tenantId: "t1", oem: "Honda" });
    const chunks = await provider.fetch("Camry", { tenantId: "t1", oem: "Honda", eulaAccepted: true });
    expect(chunks).toEqual([]);
  });
});

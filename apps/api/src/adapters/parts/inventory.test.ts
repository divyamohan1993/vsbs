import { describe, it, expect } from "vitest";
import {
  PartsInventoryAdapter,
  makeDemoInventory,
  SEED_PART_CATALOG,
  getCatalogEntry,
} from "./inventory.js";

describe("PartsInventoryAdapter", () => {
  it("reports unknown SC as unavailable for any part", () => {
    const inv = new PartsInventoryAdapter();
    const r = inv.available("SC-NONE", ["BOSCH-BP1234"]);
    expect(r.available).toBe(false);
    expect(r.missing).toEqual(["BOSCH-BP1234"]);
  });

  it("reports availability with prices and worst ETA", () => {
    const inv = makeDemoInventory();
    const r = inv.available("SC-IN-DEL-01", ["BOSCH-BP1234", "BOSCH-0451103300"]);
    expect(r.available).toBe(true);
    expect(r.totalPriceInr).toBe(4600 + 850);
    expect(r.worstEtaMinutes).toBe(5);
    expect(r.lines).toHaveLength(2);
    const codes = r.lines.map((l) => l.code).sort();
    expect(codes).toEqual(["BOSCH-0451103300", "BOSCH-BP1234"]);
  });

  it("flags missing parts when stock is zero", () => {
    const inv = makeDemoInventory();
    const r = inv.available("SC-IN-DEL-02", ["TESLA-COOL-KIT-M3-2024"]);
    expect(r.available).toBe(false);
    expect(r.missing).toContain("TESLA-COOL-KIT-M3-2024");
  });

  it("reserve decrements available stock", () => {
    const inv = makeDemoInventory();
    const before = inv.snapshot("SC-IN-DEL-01")["BOSCH-BP1234"]!.count;
    const holdId = "11111111-1111-4111-8111-111111111111";
    const hold = inv.reserve("SC-IN-DEL-01", ["BOSCH-BP1234"], holdId, 60);
    expect(hold.holdId).toBe(holdId);
    const after = inv.snapshot("SC-IN-DEL-01")["BOSCH-BP1234"]!.count;
    expect(after).toBe(before - 1);
  });

  it("reserve is idempotent on the same holdId", () => {
    const inv = makeDemoInventory();
    const holdId = "22222222-2222-4222-8222-222222222222";
    inv.reserve("SC-IN-DEL-01", ["BOSCH-BP1234"], holdId, 60);
    const after = inv.snapshot("SC-IN-DEL-01")["BOSCH-BP1234"]!.count;
    inv.reserve("SC-IN-DEL-01", ["BOSCH-BP1234"], holdId, 60);
    const again = inv.snapshot("SC-IN-DEL-01")["BOSCH-BP1234"]!.count;
    expect(after).toBe(again);
  });

  it("release returns stock and clears the hold", () => {
    const inv = makeDemoInventory();
    const before = inv.snapshot("SC-IN-DEL-01")["BOSCH-BP1234"]!.count;
    const holdId = "33333333-3333-4333-8333-333333333333";
    inv.reserve("SC-IN-DEL-01", ["BOSCH-BP1234"], holdId, 60);
    const released = inv.release(holdId);
    expect(released).toBe(true);
    const after = inv.snapshot("SC-IN-DEL-01")["BOSCH-BP1234"]!.count;
    expect(after).toBe(before);
  });

  it("confirmConsume drops the hold without restoring stock", () => {
    const inv = makeDemoInventory();
    const before = inv.snapshot("SC-IN-DEL-01")["BOSCH-BP1234"]!.count;
    const holdId = "44444444-4444-4444-8444-444444444444";
    inv.reserve("SC-IN-DEL-01", ["BOSCH-BP1234"], holdId, 60);
    const consumed = inv.confirmConsume(holdId);
    expect(consumed).toBe(true);
    const after = inv.snapshot("SC-IN-DEL-01")["BOSCH-BP1234"]!.count;
    expect(after).toBe(before - 1);
  });

  it("reserve throws when a requested part is not available", () => {
    const inv = makeDemoInventory();
    expect(() =>
      inv.reserve(
        "SC-IN-DEL-01",
        ["NOT-A-REAL-PART"],
        "55555555-5555-4555-8555-555555555555",
        60,
      ),
    ).toThrow();
  });

  it("seed catalog has every demo SKU registered", () => {
    expect(SEED_PART_CATALOG.length).toBeGreaterThan(8);
    expect(getCatalogEntry("BOSCH-BP1234")?.manufacturer).toBe("Bosch");
    expect(getCatalogEntry("MERC-EQS-CELL-MOD-A1")?.manufacturer).toBe("Mercedes-Benz");
    expect(getCatalogEntry("does-not-exist")).toBeUndefined();
  });

  it("snapshot of unknown SC returns an empty record", () => {
    const inv = new PartsInventoryAdapter();
    expect(inv.snapshot("SC-NONE")).toEqual({});
  });

  it("seedSc replaces stock for a service centre", () => {
    const inv = new PartsInventoryAdapter();
    inv.seedSc("SC-X", { "BOSCH-BP1234": { count: 9, priceInr: 100, etaMinutes: 1 } });
    expect(inv.snapshot("SC-X")["BOSCH-BP1234"]!.count).toBe(9);
    inv.seedSc("SC-X", { "BOSCH-BP1234": { count: 1, priceInr: 100, etaMinutes: 1 } });
    expect(inv.snapshot("SC-X")["BOSCH-BP1234"]!.count).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import {
  StandardErasureCoordinator,
  MapErasureStore,
  buildSimErasureCoordinator,
} from "../src/erasure.js";

describe("StandardErasureCoordinator", () => {
  it("cascades across all stores and reports per-store counts", async () => {
    const { coordinator, stores } = buildSimErasureCoordinator();
    stores.firestore.put("u1", { rec: 1 });
    stores.firestore.put("u1", { rec: 2 });
    stores.storage.put("u1", { obj: "photo.jpg" });
    stores.bigquery.put("u1", { row: 1 });
    stores.backups.put("u1", { dek: "xxx" });
    stores.caches.put("u1", { sess: "abc" });

    const req = await coordinator.requestErasure({ userId: "u1", scope: "all" });
    expect(req.status).toBe("pending");

    const done = await coordinator.executeErasure(req.requestId);
    expect(done.status).toBe("completed");
    expect(done.scopes.firestore).toBe(2);
    expect(done.scopes.storage).toBe(1);
    expect(done.scopes.bigquery).toBe(1);
    expect(done.scopes.backups).toBe(1);
    expect(done.scopes.caches).toBe(1);
    expect(done.erasedAt).toBeDefined();

    const { erased } = await coordinator.verifyErased("u1");
    expect(erased).toBe(true);
  });

  it("is idempotent on requestErasure with the same idempotency key", async () => {
    const store = new MapErasureStore("firestore");
    const coordinator = new StandardErasureCoordinator([store]);
    const a = await coordinator.requestErasure({ userId: "u1", scope: "all", requestId: "key-1" });
    const b = await coordinator.requestErasure({ userId: "u1", scope: "all", requestId: "key-1" });
    expect(a.tombstoneId).toBe(b.tombstoneId);
    expect(a.requestId).toBe("key-1");
  });

  it("does not double-execute a completed erasure", async () => {
    const { coordinator, stores } = buildSimErasureCoordinator();
    stores.firestore.put("u2", { rec: 1 });
    const req = await coordinator.requestErasure({ userId: "u2", scope: "all" });
    const done1 = await coordinator.executeErasure(req.requestId);
    expect(done1.scopes.firestore).toBe(1);
    const done2 = await coordinator.executeErasure(req.requestId);
    expect(done2.scopes.firestore).toBe(1);
  });

  it("throws when executing an unknown requestId", async () => {
    const { coordinator } = buildSimErasureCoordinator();
    await expect(coordinator.executeErasure("not-a-request")).rejects.toThrow();
  });

  it("listForUser returns receipts in order", async () => {
    const { coordinator, stores } = buildSimErasureCoordinator();
    stores.firestore.put("u3", { rec: 1 });
    const a = await coordinator.requestErasure({ userId: "u3", scope: "pii-only" });
    await coordinator.executeErasure(a.requestId);
    stores.firestore.put("u3", { rec: 2 });
    const b = await coordinator.requestErasure({ userId: "u3", scope: "all" });
    const list = await coordinator.listForUser("u3");
    expect(list.map((r) => r.requestId)).toEqual([a.requestId, b.requestId]);
  });
});

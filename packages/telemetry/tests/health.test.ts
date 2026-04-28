import { describe, expect, it } from "vitest";
import {
  HealthChecker,
  makeAlloyDbPing,
  makeFirestorePing,
  makeSecretManagerList,
  makeLlmProviderPing,
} from "../src/health.js";

describe("HealthChecker", () => {
  it("aggregates healthy checks", async () => {
    const c = new HealthChecker();
    c.register("alloydb", makeAlloyDbPing({ mode: "sim" }));
    c.register("firestore", makeFirestorePing({ mode: "sim" }));
    c.register("secrets", makeSecretManagerList({ mode: "sim" }));
    c.register("llm", makeLlmProviderPing({ mode: "sim" }));
    const r = await c.runAll();
    expect(r.status).toBe("healthy");
    expect(Object.keys(r.checks).sort()).toEqual(["alloydb", "firestore", "llm", "secrets"]);
  });

  it("aggregates degraded if any check is degraded", async () => {
    const c = new HealthChecker();
    c.register("a", async () => ({ status: "healthy", latency_ms: 1 }));
    c.register("b", async () => ({ status: "degraded", latency_ms: 1, message: "slow" }));
    const r = await c.runAll();
    expect(r.status).toBe("degraded");
  });

  it("aggregates unhealthy if any check is unhealthy", async () => {
    const c = new HealthChecker();
    c.register("a", async () => ({ status: "healthy", latency_ms: 1 }));
    c.register("b", async () => ({ status: "unhealthy", latency_ms: 1, message: "down" }));
    const r = await c.runAll();
    expect(r.status).toBe("unhealthy");
  });

  it("captures errors thrown from a check function", async () => {
    const c = new HealthChecker();
    c.register("explodes", async () => {
      throw new Error("bang");
    });
    const r = await c.runAll();
    expect(r.checks.explodes!.status).toBe("unhealthy");
    expect(r.checks.explodes!.message).toContain("bang");
  });

  it("times out a slow check", async () => {
    const c = new HealthChecker({ timeoutMs: 50 });
    c.register("slow", async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { status: "healthy", latency_ms: 200 };
    });
    const r = await c.runAll();
    expect(r.checks.slow!.status).toBe("unhealthy");
    expect(r.checks.slow!.message).toContain("timeout");
  });

  it("caches results within ttl and re-runs after invalidate", async () => {
    let invocations = 0;
    const c = new HealthChecker({ cacheTtlMs: 10_000 });
    c.register("a", async () => {
      invocations += 1;
      return { status: "healthy", latency_ms: 1 };
    });
    await c.runOne("a");
    await c.runOne("a");
    expect(invocations).toBe(1);
    c.invalidate("a");
    await c.runOne("a");
    expect(invocations).toBe(2);
  });

  it("rejects invalid check names", () => {
    const c = new HealthChecker();
    expect(() => c.register("BAD NAME", async () => ({ status: "healthy", latency_ms: 0 }))).toThrow();
    expect(() => c.register("", async () => ({ status: "healthy", latency_ms: 0 }))).toThrow();
  });

  it("list() returns all registered names", () => {
    const c = new HealthChecker();
    c.register("alloydb", makeAlloyDbPing({ mode: "sim" }));
    c.register("firestore", makeFirestorePing({ mode: "sim" }));
    expect(c.list().sort()).toEqual(["alloydb", "firestore"]);
  });

  it("unregister removes checks", async () => {
    const c = new HealthChecker();
    c.register("a", async () => ({ status: "healthy", latency_ms: 1 }));
    expect(c.unregister("a")).toBe(true);
    expect(c.list()).toEqual([]);
  });
});

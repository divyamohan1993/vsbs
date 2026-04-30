// =============================================================================
// CanaryRouter — deterministic bucketing, recording, and 0% / 100% extremes.
// =============================================================================

import { describe, it, expect } from "vitest";

import { AgentRole } from "./roles.js";
import {
  CanaryRouter,
  InMemoryCanaryRecorder,
  bucketFor,
} from "./canary.js";
import type { ModelPin } from "./version-pin.js";

const PINNED: ModelPin = {
  provider: "vertex-claude",
  modelId: "claude-opus-4-6",
  version: "2026-04-01",
  capabilityProfile: ["tool-use"],
  pinnedAt: new Date(0).toISOString(),
};

const CANDIDATE = {
  provider: "vertex-claude",
  modelId: "claude-opus-4-7",
  version: "2026-05-01",
  reason: "candidate v4.7 evaluation",
};

describe("bucketFor determinism", () => {
  it("same input yields the same bucket every call", () => {
    const a = bucketFor("conv-1");
    const b = bucketFor("conv-1");
    expect(a).toBe(b);
  });

  it("different inputs yield (mostly) different buckets", () => {
    const buckets = new Set<number>();
    for (let i = 0; i < 100; i++) buckets.add(bucketFor(`conv-${i}`));
    expect(buckets.size).toBeGreaterThan(40); // strong dispersion
  });

  it("salt changes the bucket", () => {
    const a = bucketFor("conv-1", "");
    const b = bucketFor("conv-1", "salt");
    expect(a).not.toBe(b);
  });

  it("buckets are bounded to [0, 99]", () => {
    for (let i = 0; i < 1000; i++) {
      const b = bucketFor(`x${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
});

describe("CanaryRouter routing", () => {
  it("0% canary always routes to pinned", () => {
    const recorder = new InMemoryCanaryRecorder();
    const router = new CanaryRouter(
      { candidates: { [AgentRole.Concierge]: CANDIDATE }, canaryPercent: 0, routingSalt: "" },
      recorder,
    );
    const decision = router.route(AgentRole.Concierge, "conv-1", PINNED);
    expect(decision.arm).toBe("pinned");
  });

  it("100% canary always routes to canary", () => {
    const recorder = new InMemoryCanaryRecorder();
    const router = new CanaryRouter(
      { candidates: { [AgentRole.Concierge]: CANDIDATE }, canaryPercent: 100, routingSalt: "" },
      recorder,
    );
    const decision = router.route(AgentRole.Concierge, "conv-x", PINNED);
    expect(decision.arm).toBe("canary");
  });

  it("the same conversation always lands on the same arm", () => {
    const router = new CanaryRouter({
      candidates: { [AgentRole.Concierge]: CANDIDATE },
      canaryPercent: 50,
      routingSalt: "test-salt",
    });
    const a = router.route(AgentRole.Concierge, "conv-stable", PINNED).arm;
    const b = router.route(AgentRole.Concierge, "conv-stable", PINNED).arm;
    const c = router.route(AgentRole.Concierge, "conv-stable", PINNED).arm;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("a role with no candidate always routes to pinned", () => {
    const router = new CanaryRouter({
      candidates: {},
      canaryPercent: 100,
      routingSalt: "",
    });
    const decision = router.route(AgentRole.Verifier, "conv-1", PINNED);
    expect(decision.arm).toBe("pinned");
    expect(decision.canary).toBeUndefined();
  });

  it("split is approximately the configured percent over many conversations", () => {
    const router = new CanaryRouter({
      candidates: { [AgentRole.Concierge]: CANDIDATE },
      canaryPercent: 30,
      routingSalt: "",
    });
    let canary = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const decision = router.route(AgentRole.Concierge, `conv-${i}`, PINNED);
      if (decision.arm === "canary") canary += 1;
    }
    const pct = (canary / N) * 100;
    expect(pct).toBeGreaterThan(20); // wide tolerance
    expect(pct).toBeLessThan(40);
  });

  it("records every routing decision for downstream eval", () => {
    const recorder = new InMemoryCanaryRecorder();
    const router = new CanaryRouter(
      { candidates: { [AgentRole.Concierge]: CANDIDATE }, canaryPercent: 50, routingSalt: "" },
      recorder,
    );
    router.route(AgentRole.Concierge, "c1", PINNED);
    router.route(AgentRole.Concierge, "c2", PINNED);
    router.route(AgentRole.Concierge, "c3", PINNED);
    expect(recorder.routes().length).toBe(3);
  });

  it("recordCall captures pinned-vs-canary verdicts", () => {
    const recorder = new InMemoryCanaryRecorder();
    const router = new CanaryRouter(
      { candidates: { [AgentRole.Concierge]: CANDIDATE }, canaryPercent: 0, routingSalt: "" },
      recorder,
    );
    router.recordCall({
      role: AgentRole.Concierge,
      conversationId: "c1",
      arm: "pinned",
      pinnedModel: "claude-opus-4-6",
      canaryModel: "claude-opus-4-7",
      verdict: { ok: true },
      shadowVerdict: { ok: true },
    });
    expect(recorder.records().length).toBe(1);
    expect(recorder.records()[0]!.shadowVerdict).toBeDefined();
  });
});

describe("CanaryRouter validation", () => {
  it("rejects canaryPercent < 0", () => {
    expect(
      () =>
        new CanaryRouter({
          candidates: {},
          canaryPercent: -1,
          routingSalt: "",
        }),
    ).toThrow();
  });

  it("rejects canaryPercent > 100", () => {
    expect(
      () =>
        new CanaryRouter({
          candidates: {},
          canaryPercent: 101,
          routingSalt: "",
        }),
    ).toThrow();
  });
});

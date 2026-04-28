import { describe, expect, it } from "vitest";

import { StandardBreachReporter, SLA_HOURS } from "../src/breach.js";

const baseScope = {
  principals: 100,
  records: 250,
  jurisdictions: ["IN"],
  dataCategories: ["pii"],
};

describe("StandardBreachReporter", () => {
  it("records an incident with a 72h SLA deadline from detection", async () => {
    const r = new StandardBreachReporter();
    const detectedAt = "2026-04-28T10:00:00.000Z";
    const inc = await r.recordIncident({
      severity: "SEV-1",
      category: "confidentiality",
      scope: baseScope,
      description: "Unauthorised read of consent_log",
      detectedAt,
    });
    expect(inc.severity).toBe("SEV-1");
    const expected = new Date(new Date(detectedAt).getTime() + SLA_HOURS * 3600_000).toISOString();
    expect(inc.slaDeadline).toBe(expected);
    expect(inc.timeline[0]?.kind).toBe("detected");
  });

  it("computes hoursRemaining correctly within and after the window", async () => {
    const r = new StandardBreachReporter();
    const detectedAt = "2026-04-28T10:00:00.000Z";
    const inc = await r.recordIncident({
      severity: "SEV-1",
      category: "confidentiality",
      scope: baseScope,
      description: "Test incident for SLA clock checks",
      detectedAt,
    });
    const remainingAt24 = await r.hoursRemaining(inc.id, new Date(detectedAt).getTime() + 24 * 3600_000);
    expect(remainingAt24).toBeCloseTo(48, 6);
    const remainingAfter = await r.hoursRemaining(inc.id, new Date(detectedAt).getTime() + 80 * 3600_000);
    expect(remainingAfter).toBe(0);
  });

  it("isOverdue is true once SLA passes without DPB notification", async () => {
    const r = new StandardBreachReporter();
    const detectedAt = "2026-04-28T10:00:00.000Z";
    const inc = await r.recordIncident({
      severity: "SEV-1",
      category: "confidentiality",
      scope: baseScope,
      description: "Test incident for SLA clock checks",
      detectedAt,
    });
    expect(await r.isOverdue(inc.id, new Date(detectedAt).getTime() + 80 * 3600_000)).toBe(true);
    await r.notifyDPB(inc.id, "draft notification body");
    expect(await r.isOverdue(inc.id, new Date(detectedAt).getTime() + 80 * 3600_000)).toBe(false);
  });

  it("notifyDataPrincipals enqueues one notification per user", async () => {
    const r = new StandardBreachReporter();
    const inc = await r.recordIncident({
      severity: "SEV-2",
      category: "confidentiality",
      scope: baseScope,
      description: "Test incident for SLA clock checks",
    });
    const notes = await r.notifyDataPrincipals(inc.id, ["u1", "u2", "u3"], "Body");
    expect(notes).toHaveLength(3);
    const tl = await r.getIncidentTimeline(inc.id);
    expect(tl.filter((e) => e.kind === "principals-notified")).toHaveLength(3);
  });

  it("close stamps closedAt and adds a closed event", async () => {
    const r = new StandardBreachReporter();
    const inc = await r.recordIncident({
      severity: "SEV-3",
      category: "availability",
      scope: baseScope,
      description: "Cache outage caused intermittent failures",
    });
    const closed = await r.close(inc.id);
    expect(closed.closedAt).toBeDefined();
    const tl = await r.getIncidentTimeline(inc.id);
    expect(tl.at(-1)?.kind).toBe("closed");
  });
});

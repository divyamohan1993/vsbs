import { describe, expect, it } from "vitest";

import { DpiaGenerator, parseFrontmatter, inMemoryAssessmentSource } from "../src/dpia.js";

const SAMPLE_DPIA = `---
type: DPIA
system: VSBS
version: 1.0.0
date: 2026-04-15
author: Divya Mohan
regulatory_basis:
  - DPDP Act 2023
  - GDPR Art. 35
signoff_required:
  - DPO
  - Exec sponsor
risks:
  - id: R-CONF
    description: Confidentiality breach via model provider
    inherent: High
    controls:
      - PII redaction middleware
      - Hybrid PQ envelope
    residual: Low
  - id: R-INT
    description: Prompt injection on retrieved TSB
    inherent: High
    controls:
      - System vs retrieved channel split
    residual: Medium
---

# Sample DPIA body

The body of the DPIA goes here.
`;

const SAMPLE_FRIA = `# FRIA without frontmatter

A FRIA document with no machine-readable header.
`;

describe("DPIA frontmatter parser", () => {
  it("parses the DPIA frontmatter into a Zod-validated object", () => {
    const { fm, rest } = parseFrontmatter(SAMPLE_DPIA);
    expect(fm).not.toBeNull();
    expect(fm?.type).toBe("DPIA");
    expect(fm?.system).toBe("VSBS");
    expect(fm?.version).toBe("1.0.0");
    expect(fm?.signoff_required).toContain("DPO");
    expect(fm?.risks).toHaveLength(2);
    expect(fm?.risks[0]?.id).toBe("R-CONF");
    expect(fm?.risks[0]?.controls).toContain("Hybrid PQ envelope");
    expect(rest.startsWith("# Sample DPIA body")).toBe(true);
  });

  it("returns null frontmatter when none is present", () => {
    const { fm, rest } = parseFrontmatter(SAMPLE_FRIA);
    expect(fm).toBeNull();
    expect(rest).toBe(SAMPLE_FRIA);
  });

  it("DpiaGenerator surfaces structured risks and signoff_required", async () => {
    const src = inMemoryAssessmentSource({
      "/dpia.md": SAMPLE_DPIA,
      "/fria.md": SAMPLE_FRIA,
    });
    const gen = new DpiaGenerator({ source: src, dpiaPath: "/dpia.md", friaPath: "/fria.md" });
    const dpia = await gen.generate("DPIA");
    expect(dpia.risks).toHaveLength(2);
    expect(dpia.signoff_required).toEqual(["DPO", "Exec sponsor"]);

    const fria = await gen.generate("FRIA");
    expect(fria.frontmatter).toBeNull();
    expect(fria.markdown.includes("FRIA without frontmatter")).toBe(true);
  });

  it("rejects malformed frontmatter (missing required fields)", () => {
    const bad = `---
type: DPIA
system: only
---

body
`;
    expect(() => parseFrontmatter(bad)).toThrow();
  });
});

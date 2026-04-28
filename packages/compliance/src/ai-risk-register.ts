// =============================================================================
// AI Risk Register — NIST AI RMF 1.0 (Govern / Map / Measure / Manage) +
// OWASP GenAI Top 10 (2025) mapping.
//
// 22 hard-coded rows. Each row references a control surface in the codebase
// or a documented runbook. The intent is that "drift between this register
// and the cited file" is itself a finding (per docs/compliance/
// ai-risk-register.md).
// =============================================================================

import { z } from "zod";

export const NistCategorySchema = z.enum(["govern", "map", "measure", "manage"]);
export type NistCategory = z.infer<typeof NistCategorySchema>;

export const RiskStatusSchema = z.enum(["open", "mitigated", "accepted"]);
export type RiskStatus = z.infer<typeof RiskStatusSchema>;

export const RiskSeveritySchema = z.enum(["Low", "Medium", "High", "Critical"]);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const AiRiskRowSchema = z.object({
  id: z.string().regex(/^R\d{2,3}$/),
  category: NistCategorySchema,
  description: z.string().min(8),
  controls: z.array(z.string().min(1)).min(1),
  owascCategory: z.string().min(2),
  inherent: RiskSeveritySchema,
  residual: RiskSeveritySchema,
  status: RiskStatusSchema,
  owner: z.string().min(1),
  reviewCadence: z.enum(["weekly", "monthly", "quarterly", "per-onboarding"]),
});
export type AiRiskRow = z.infer<typeof AiRiskRowSchema>;

export const AI_RISK_REGISTER: ReadonlyArray<AiRiskRow> = [
  {
    id: "R01",
    category: "manage",
    description: "Prompt injection via retrieved TSB or user text poisoning tool calls",
    controls: ["system-vs-retrieved channel split", "deny-list", "Haiku verifier on privileged tools"],
    owascCategory: "OWASP-LLM01",
    inherent: "High",
    residual: "Medium",
    status: "mitigated",
    owner: "Sec lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R02",
    category: "manage",
    description: "Sensitive info disclosure in model output or logs",
    controls: ["PII redaction middleware", "unified error envelope", "structured log redactor"],
    owascCategory: "OWASP-LLM02",
    inherent: "High",
    residual: "Low",
    status: "mitigated",
    owner: "Sec lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R03",
    category: "manage",
    description: "Supply chain compromise of model artifacts or SDK",
    controls: ["multi-provider fallback", "lockfile committed", "Trivy + OSV", "Binary Authorization"],
    owascCategory: "OWASP-LLM03",
    inherent: "High",
    residual: "Medium",
    status: "mitigated",
    owner: "Eng lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R04",
    category: "measure",
    description: "Tool args hallucinated into wrong types (improper output handling)",
    controls: ["Zod schemas on every tool", "verifier chain", "schema-validated envelopes"],
    owascCategory: "OWASP-LLM05",
    inherent: "High",
    residual: "Low",
    status: "mitigated",
    owner: "Eng lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R05",
    category: "manage",
    description: "Excessive agency: rogue tool call outside scope",
    controls: ["per-specialist scope", "signed CommandGrant", "witness co-signature"],
    owascCategory: "OWASP-LLM06",
    inherent: "Critical",
    residual: "Medium",
    status: "mitigated",
    owner: "Sec lead",
    reviewCadence: "monthly",
  },
  {
    id: "R06",
    category: "measure",
    description: "System prompt leakage into model output or logs",
    controls: ["trusted vs retrieved channel split", "leakage tests in CI", "log sanitiser"],
    owascCategory: "OWASP-LLM07",
    inherent: "Medium",
    residual: "Low",
    status: "mitigated",
    owner: "Sec lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R07",
    category: "manage",
    description: "Vector / embedding weaknesses: retrieval poisoning of KG",
    controls: ["source allow-list", "signed corpora", "diff review on ingest"],
    owascCategory: "OWASP-LLM08",
    inherent: "High",
    residual: "Low",
    status: "mitigated",
    owner: "Data lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R08",
    category: "measure",
    description: "Misinformation: ungrounded diagnosis given to owner",
    controls: ["groundedness gate with citations", "dual-cross-check safety pipeline", "explanation drawer"],
    owascCategory: "OWASP-LLM09",
    inherent: "High",
    residual: "Medium",
    status: "mitigated",
    owner: "AI lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R09",
    category: "manage",
    description: "Unbounded consumption: cost blowout via loops",
    controls: ["per-session cost ceiling", "Cloud Armor rate limit", "token budget per turn"],
    owascCategory: "OWASP-LLM10",
    inherent: "Medium",
    residual: "Low",
    status: "mitigated",
    owner: "Eng lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R10",
    category: "map",
    description: "Context drift as new OEMs onboard",
    controls: ["OEM onboarding checklist", "AutonomyCapabilityContext schema", "fail-closed resolver default"],
    owascCategory: "NIST-MAP-1.1",
    inherent: "Medium",
    residual: "Low",
    status: "mitigated",
    owner: "Product",
    reviewCadence: "per-onboarding",
  },
  {
    id: "R11",
    category: "measure",
    description: "Bias drift: dispatch and wellbeing scoring across geography, age, gender",
    controls: ["weekly demographic-parity monitor", "<= 5% disparity alert", "independent fairness gate"],
    owascCategory: "NIST-MEASURE-2.5",
    inherent: "High",
    residual: "Medium",
    status: "open",
    owner: "AI lead",
    reviewCadence: "weekly",
  },
  {
    id: "R12",
    category: "manage",
    description: "Incident response lag on active exploit",
    controls: ["72h breach runbook", "on-call rota", "automated pager", "kill-switch flags"],
    owascCategory: "NIST-MANAGE-3.2",
    inherent: "Critical",
    residual: "Low",
    status: "mitigated",
    owner: "SRE",
    reviewCadence: "monthly",
  },
  {
    id: "R13",
    category: "manage",
    description: "CommandGrant replay across vehicles or windows",
    controls: ["grantId uuid", "notBefore/notAfter", "nonce", "Merkle authority chain"],
    owascCategory: "Autonomy-A1",
    inherent: "Critical",
    residual: "Low",
    status: "mitigated",
    owner: "Sec lead",
    reviewCadence: "monthly",
  },
  {
    id: "R14",
    category: "manage",
    description: "Auto-pay cap bypass via forged quote",
    controls: ["cap encoded in signed grant", "PSP reserved hold", "escalate-on-exceed"],
    owascCategory: "Autonomy-A2",
    inherent: "Critical",
    residual: "Low",
    status: "mitigated",
    owner: "Payments",
    reviewCadence: "monthly",
  },
  {
    id: "R15",
    category: "manage",
    description: "Sensor spoofing on the autonomy ingest path",
    controls: ["origin stamping (real|sim)", "cross-modal arbitration", "physics plausibility check"],
    owascCategory: "Autonomy-A3",
    inherent: "High",
    residual: "Low",
    status: "mitigated",
    owner: "Safety",
    reviewCadence: "quarterly",
  },
  {
    id: "R16",
    category: "measure",
    description: "Sensor vs fault misattribution (SOTIF false positive)",
    controls: ["3-state arbitration", "uncertainty-aware RUL lower bound", "double-check before commit"],
    owascCategory: "ISO-21448",
    inherent: "High",
    residual: "Medium",
    status: "mitigated",
    owner: "Safety",
    reviewCadence: "quarterly",
  },
  {
    id: "R17",
    category: "govern",
    description: "Consent forgery or server-side flipping of granted",
    controls: ["append-only consent log", "evidenceHash of notice shown", "WORM export for audit"],
    owascCategory: "DPDP-Rule-3",
    inherent: "Medium",
    residual: "Low",
    status: "mitigated",
    owner: "DPO",
    reviewCadence: "quarterly",
  },
  {
    id: "R18",
    category: "manage",
    description: "Crypto: CommandGrant signing-key compromise",
    controls: ["WebAuthn passkey", "Cloud KMS ML-DSA-65 witness", "30-day rotate", "revocation list"],
    owascCategory: "Crypto-K1",
    inherent: "Critical",
    residual: "Low",
    status: "mitigated",
    owner: "Sec lead",
    reviewCadence: "monthly",
  },
  {
    id: "R19",
    category: "govern",
    description: "Hallucination on safety-critical advice (red-flag underreport)",
    controls: ["hardcoded SAFETY_RED_FLAGS", "post-check agreement", "deterministic short-circuit"],
    owascCategory: "OWASP-LLM09",
    inherent: "Critical",
    residual: "Low",
    status: "mitigated",
    owner: "Safety",
    reviewCadence: "monthly",
  },
  {
    id: "R20",
    category: "govern",
    description: "PII exfiltration via crafted prompts",
    controls: ["egress redaction on prompts", "deny-list of PII tokens", "model output filter"],
    owascCategory: "OWASP-LLM02",
    inherent: "High",
    residual: "Low",
    status: "mitigated",
    owner: "Sec lead",
    reviewCadence: "quarterly",
  },
  {
    id: "R21",
    category: "govern",
    description: "Regulatory drift on AI Act / DPDP Rules updates not propagated",
    controls: ["versioned policy resolver", "quarterly compliance review", "subscribe to gazette/EUR-Lex"],
    owascCategory: "Regulatory-D1",
    inherent: "Medium",
    residual: "Medium",
    status: "open",
    owner: "DPO",
    reviewCadence: "quarterly",
  },
  {
    id: "R22",
    category: "manage",
    description: "Third-party LLM availability outage breaks the booking flow",
    controls: ["multi-provider fallback", "graceful degradation", "scripted offline path"],
    owascCategory: "OWASP-LLM03",
    inherent: "High",
    residual: "Medium",
    status: "mitigated",
    owner: "Eng lead",
    reviewCadence: "quarterly",
  },
] as const;

/** Validate the register at module load. Throws at import if a row is bad. */
const _validated = AI_RISK_REGISTER.map((r) => AiRiskRowSchema.parse(r));
void _validated;

export interface RegisterFilters {
  category?: NistCategory;
  status?: RiskStatus;
  owascPrefix?: string;
  cadence?: AiRiskRow["reviewCadence"];
}

export function getAiRiskRegister(filters: RegisterFilters = {}): AiRiskRow[] {
  return AI_RISK_REGISTER.filter((r) => {
    if (filters.category && r.category !== filters.category) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.owascPrefix && !r.owascCategory.startsWith(filters.owascPrefix)) return false;
    if (filters.cadence && r.reviewCadence !== filters.cadence) return false;
    return true;
  });
}

export function getRiskById(id: string): AiRiskRow | undefined {
  return AI_RISK_REGISTER.find((r) => r.id === id);
}

export function registerIntegrityReport(): {
  total: number;
  uniqueIds: boolean;
  byCategory: Record<NistCategory, number>;
  byStatus: Record<RiskStatus, number>;
} {
  const ids = new Set(AI_RISK_REGISTER.map((r) => r.id));
  const byCategory: Record<NistCategory, number> = { govern: 0, map: 0, measure: 0, manage: 0 };
  const byStatus: Record<RiskStatus, number> = { open: 0, mitigated: 0, accepted: 0 };
  for (const r of AI_RISK_REGISTER) {
    byCategory[r.category] += 1;
    byStatus[r.status] += 1;
  }
  return {
    total: AI_RISK_REGISTER.length,
    uniqueIds: ids.size === AI_RISK_REGISTER.length,
    byCategory,
    byStatus,
  };
}

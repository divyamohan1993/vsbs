// =============================================================================
// Per-jurisdiction policy resolver.
//
// Maps a user jurisdiction code to the applicable regulation, lawful bases,
// required notices, erasure right, data localisation requirement, and DPO
// requirement. Driven by the live text of:
//   - DPDP Act 2023 + DPDP Rules 2025  (India)
//   - GDPR + EU AI Act  (EU)
//   - UK GDPR + DPA 2018  (UK)
//   - CCPA / CPRA  (California)
//   - Patchwork of state laws + sectoral federal  (rest of US)
// =============================================================================

import { z } from "zod";

export const JurisdictionSchema = z.enum([
  "IN",
  "US-CA",
  "US-other",
  "EU",
  "UK",
  "other",
]);
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

export const LawfulBasisSchema = z.enum([
  "consent",
  "contract",
  "legitimate-interest",
  "legal-obligation",
  "vital-interest",
  "public-task",
]);
export type LawfulBasis = z.infer<typeof LawfulBasisSchema>;

export const PolicyResolutionSchema = z.object({
  jurisdiction: JurisdictionSchema,
  regulation: z.array(z.string()).min(1),
  lawfulBases: z.array(LawfulBasisSchema).min(1),
  requiredNotices: z.array(z.string()).min(1),
  rightToErasure: z.boolean(),
  rightToPortability: z.boolean(),
  rightToObjectAutomatedDecision: z.boolean(),
  dataLocalisation: z.string().nullable(),
  dpoRequired: z.boolean(),
  breachNotificationHours: z.number().int().positive(),
  ageOfConsent: z.number().int(),
  saleOptOutRequired: z.boolean(),
  supervisoryAuthority: z.string(),
});
export type PolicyResolution = z.infer<typeof PolicyResolutionSchema>;

const POLICIES: Record<Jurisdiction, PolicyResolution> = {
  IN: PolicyResolutionSchema.parse({
    jurisdiction: "IN",
    regulation: ["DPDP Act 2023", "DPDP Rules 2025"],
    lawfulBases: ["consent", "contract", "legal-obligation", "vital-interest"],
    requiredNotices: [
      "DPDP Rule 3 notice (per-purpose, withdrawable)",
      "Data Fiduciary contact",
      "DPO contact (if Significant Data Fiduciary)",
      "Cross-border transfer disclosure",
    ],
    rightToErasure: true,
    rightToPortability: false,
    rightToObjectAutomatedDecision: false,
    dataLocalisation: "asia-south1 (India residency)",
    dpoRequired: true,
    breachNotificationHours: 72,
    ageOfConsent: 18,
    saleOptOutRequired: false,
    supervisoryAuthority: "Data Protection Board of India",
  }),
  EU: PolicyResolutionSchema.parse({
    jurisdiction: "EU",
    regulation: ["GDPR (Regulation (EU) 2016/679)", "EU AI Act (Regulation (EU) 2024/1689)"],
    lawfulBases: [
      "consent",
      "contract",
      "legal-obligation",
      "vital-interest",
      "public-task",
      "legitimate-interest",
    ],
    requiredNotices: [
      "GDPR Art. 13/14 notice",
      "DPO contact",
      "Data subject rights summary",
      "Lead supervisory authority contact",
      "AI Act Art. 13 transparency notice for high-risk system",
    ],
    rightToErasure: true,
    rightToPortability: true,
    rightToObjectAutomatedDecision: true,
    dataLocalisation: "europe-west (EEA residency by default)",
    dpoRequired: true,
    breachNotificationHours: 72,
    ageOfConsent: 16,
    saleOptOutRequired: false,
    supervisoryAuthority: "Lead supervisory authority per GDPR Art. 56",
  }),
  UK: PolicyResolutionSchema.parse({
    jurisdiction: "UK",
    regulation: ["UK GDPR", "Data Protection Act 2018"],
    lawfulBases: [
      "consent",
      "contract",
      "legal-obligation",
      "vital-interest",
      "public-task",
      "legitimate-interest",
    ],
    requiredNotices: [
      "UK GDPR Art. 13/14 notice",
      "DPO or representative contact",
      "ICO complaint route",
    ],
    rightToErasure: true,
    rightToPortability: true,
    rightToObjectAutomatedDecision: true,
    dataLocalisation: null,
    dpoRequired: true,
    breachNotificationHours: 72,
    ageOfConsent: 13,
    saleOptOutRequired: false,
    supervisoryAuthority: "Information Commissioner's Office (ICO)",
  }),
  "US-CA": PolicyResolutionSchema.parse({
    jurisdiction: "US-CA",
    regulation: ["CCPA", "CPRA"],
    lawfulBases: ["consent", "contract", "legitimate-interest", "legal-obligation"],
    requiredNotices: [
      "CCPA Notice at Collection",
      "Right to Know / Delete / Correct / Limit Use of Sensitive PI",
      "Do Not Sell or Share My Personal Information link",
      "Privacy Policy with categories of PI collected",
    ],
    rightToErasure: true,
    rightToPortability: true,
    rightToObjectAutomatedDecision: true,
    dataLocalisation: null,
    dpoRequired: false,
    breachNotificationHours: 720,
    ageOfConsent: 13,
    saleOptOutRequired: true,
    supervisoryAuthority: "California Privacy Protection Agency (CPPA)",
  }),
  "US-other": PolicyResolutionSchema.parse({
    jurisdiction: "US-other",
    regulation: ["State patchwork (VCDPA, CPA, CTDPA, UCPA, ...)", "Sectoral federal (HIPAA, GLBA, FCRA, COPPA)"],
    lawfulBases: ["consent", "contract", "legitimate-interest", "legal-obligation"],
    requiredNotices: [
      "Privacy Policy",
      "Categories of PI collected",
      "Opt-out mechanism for targeted advertising where applicable",
    ],
    rightToErasure: true,
    rightToPortability: true,
    rightToObjectAutomatedDecision: false,
    dataLocalisation: null,
    dpoRequired: false,
    breachNotificationHours: 720,
    ageOfConsent: 13,
    saleOptOutRequired: true,
    supervisoryAuthority: "State Attorney General",
  }),
  other: PolicyResolutionSchema.parse({
    jurisdiction: "other",
    regulation: ["No specific known regime, falling back to GDPR-equivalent posture"],
    lawfulBases: ["consent", "contract"],
    requiredNotices: ["Privacy Policy", "Contact for privacy queries"],
    rightToErasure: true,
    rightToPortability: true,
    rightToObjectAutomatedDecision: false,
    dataLocalisation: null,
    dpoRequired: false,
    breachNotificationHours: 72,
    ageOfConsent: 16,
    saleOptOutRequired: false,
    supervisoryAuthority: "Local supervisory authority where designated",
  }),
};

export function resolvePolicy(j: Jurisdiction): PolicyResolution {
  return POLICIES[j];
}

export function listJurisdictions(): Jurisdiction[] {
  return [...JurisdictionSchema.options];
}

/** Map a country code (ISO 3166-1 alpha-2) plus an optional state code into
 *  one of our jurisdiction buckets. */
export function jurisdictionFor(countryCode: string, stateCode?: string): Jurisdiction {
  const cc = countryCode.toUpperCase();
  if (cc === "IN") return "IN";
  if (cc === "GB" || cc === "UK") return "UK";
  if (cc === "US") {
    if (stateCode && stateCode.toUpperCase() === "CA") return "US-CA";
    return "US-other";
  }
  const eea = new Set([
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
    "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL",
    "PT", "RO", "SE", "SI", "SK",
    "IS", "LI", "NO",
  ]);
  if (eea.has(cc)) return "EU";
  return "other";
}

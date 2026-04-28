// =============================================================================
// DPDP Rules 2025 + GDPR Art. 7 consent manager.
//
// Per-purpose, versioned, evidence-hashed, append-only. Withdrawal is a new
// row, never an edit. The notice version travels with each record so we can
// detect when a fresh consent is needed.
//
// References:
//   - DPDP Act 2023, ss. 6, 7
//   - DPDP Rules 2025, Rules 3 (notice) and 6 (consent manager)
//   - GDPR Art. 7 (conditions for consent), Recital 32 (clear affirmative act)
//   - packages/shared/src/schema/consent.ts (the canonical purpose enum)
// =============================================================================

import { z } from "zod";
import { ConsentPurposeSchema, type ConsentPurpose } from "@vsbs/shared";

import { uuidv7 } from "./uuidv7.js";
import { evidenceHash } from "./hash.js";

export const ConsentSourceSchema = z.enum(["web", "mobile", "voice", "ivr", "kiosk"]);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

export const LegalBasisSchema = z.enum([
  "contract",
  "consent",
  "legitimate-interest",
  "legal-obligation",
  "vital-interest",
  "public-task",
]);
export type LegalBasis = z.infer<typeof LegalBasisSchema>;

/** Static descriptor for a purpose: what it is, in which languages, what
 *  the lawful basis is, and whether revocation is permitted (some purposes,
 *  like service-fulfilment, ride on the contract basis and cannot simply
 *  be revoked while a contract is active). */
export const PurposeDescriptorSchema = z.object({
  purpose: ConsentPurposeSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver required"),
  description_en: z.string().min(8),
  description_hi: z.string().min(4),
  legal_basis: LegalBasisSchema,
  necessary: z.boolean(),
  revocable: z.boolean(),
  noticeUrl: z.string().url().optional(),
});
export type PurposeDescriptor = z.infer<typeof PurposeDescriptorSchema>;

/** A single immutable row in the consent log. */
export const ConsentRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  purpose: ConsentPurposeSchema,
  version: z.string(),
  action: z.enum(["grant", "revoke"]),
  timestamp: z.string().datetime(),
  evidenceHash: z.string().length(64),
  source: ConsentSourceSchema,
  ip_hash: z.string().max(64),
  reason: z.string().max(500).optional(),
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export interface RecordInput {
  userId: string;
  purpose: ConsentPurpose;
  version: string;
  evidenceHash: string;
  source: ConsentSource;
  ip_hash?: string;
}

export interface RevokeInput {
  userId: string;
  purpose: ConsentPurpose;
  reason?: string;
  source?: ConsentSource;
  ip_hash?: string;
}

export interface EffectiveConsent {
  purpose: ConsentPurpose;
  granted: boolean;
  version: string;
  at: string;
  staleAgainst?: string;
}

export interface ConsentManager {
  record(input: RecordInput): Promise<ConsentRecord>;
  revoke(input: RevokeInput): Promise<ConsentRecord>;
  effectiveConsents(userId: string): Promise<EffectiveConsent[]>;
  requiresReConsent(userId: string, latestVersions: Record<ConsentPurpose, string>): Promise<ConsentPurpose[]>;
  getConsentLog(userId: string): Promise<ConsentRecord[]>;
  hasEffective(userId: string, purpose: ConsentPurpose): Promise<boolean>;
}

/** Default purpose registry. Versions are the *notice* versions; bumping a
 *  description requires bumping the version, which forces re-consent. */
export const DEFAULT_PURPOSE_REGISTRY: Readonly<Record<ConsentPurpose, PurposeDescriptor>> = Object.freeze({
  "service-fulfilment": {
    purpose: "service-fulfilment",
    version: "1.0.0",
    description_en:
      "We use your name, contact, vehicle, and booking details to fulfil the service you have requested.",
    description_hi:
      "हम आपका नाम, संपर्क, वाहन और बुकिंग विवरण आपकी अनुरोधित सेवा पूरी करने के लिए उपयोग करते हैं।",
    legal_basis: "contract",
    necessary: true,
    revocable: false,
  },
  "diagnostic-telemetry": {
    purpose: "diagnostic-telemetry",
    version: "1.0.0",
    description_en:
      "We collect OBD-II diagnostic codes, telemetry, and sensor readings from the vehicle to diagnose faults.",
    description_hi:
      "हम दोष निदान के लिए वाहन से OBD-II कोड, टेलीमेट्री और सेंसर रीडिंग एकत्र करते हैं।",
    legal_basis: "consent",
    necessary: false,
    revocable: true,
  },
  "voice-photo-processing": {
    purpose: "voice-photo-processing",
    version: "1.0.0",
    description_en:
      "We process voice clips and photos you upload to identify the issue. Stored 30 days, then deleted.",
    description_hi:
      "हम समस्या पहचानने के लिए आपके वॉयस क्लिप और फोटो संसाधित करते हैं। 30 दिन बाद हटा दिए जाते हैं।",
    legal_basis: "consent",
    necessary: false,
    revocable: true,
  },
  marketing: {
    purpose: "marketing",
    version: "1.0.0",
    description_en:
      "We send you optional service reminders, offers, and product updates. You can opt out at any time.",
    description_hi:
      "हम वैकल्पिक सेवा रिमाइंडर, ऑफ़र और उत्पाद अपडेट भेजते हैं। आप कभी भी ऑप्ट आउट कर सकते हैं।",
    legal_basis: "consent",
    necessary: false,
    revocable: true,
  },
  "ml-improvement-anonymised": {
    purpose: "ml-improvement-anonymised",
    version: "1.0.0",
    description_en:
      "We may use anonymised, aggregated telemetry to improve our diagnostic models. No personal data leaves.",
    description_hi:
      "हम निदान मॉडल सुधारने के लिए अनाम, समेकित टेलीमेट्री उपयोग कर सकते हैं। कोई व्यक्तिगत डेटा बाहर नहीं जाता।",
    legal_basis: "consent",
    necessary: false,
    revocable: true,
  },
  "autonomy-delegation": {
    purpose: "autonomy-delegation",
    version: "1.0.0",
    description_en:
      "We mint a signed, time-bounded, geofence-bounded grant authorising the service centre to drive your vehicle.",
    description_hi:
      "हम एक हस्ताक्षरित, समय-सीमित, क्षेत्र-सीमित अनुदान बनाते हैं जो सेवा केंद्र को आपके वाहन को चलाने का अधिकार देता है।",
    legal_basis: "consent",
    necessary: false,
    revocable: true,
  },
  "autopay-within-cap": {
    purpose: "autopay-within-cap",
    version: "1.0.0",
    description_en:
      "We may charge up to your stated cap automatically when the service centre completes the work; anything above the cap requires manual approval.",
    description_hi:
      "हम सेवा पूर्ण होने पर आपकी निर्धारित सीमा तक स्वचालित रूप से शुल्क ले सकते हैं; सीमा से अधिक के लिए मैन्युअल अनुमोदन आवश्यक है।",
    legal_basis: "consent",
    necessary: false,
    revocable: true,
  },
});

export function getPurposeDescriptor(purpose: ConsentPurpose): PurposeDescriptor {
  const d = DEFAULT_PURPOSE_REGISTRY[purpose];
  return d;
}

export function latestVersions(): Record<ConsentPurpose, string> {
  const out = {} as Record<ConsentPurpose, string>;
  for (const p of Object.keys(DEFAULT_PURPOSE_REGISTRY) as ConsentPurpose[]) {
    out[p] = DEFAULT_PURPOSE_REGISTRY[p].version;
  }
  return out;
}

/** In-memory append-only log keyed by userId. The interface is the contract;
 *  swap the store for Firestore by reimplementing `record/revoke/get*` only. */
export class InMemoryConsentManager implements ConsentManager {
  readonly #rows: ConsentRecord[] = [];
  readonly #byUser = new Map<string, ConsentRecord[]>();

  async record(input: RecordInput): Promise<ConsentRecord> {
    const purpose = ConsentPurposeSchema.parse(input.purpose);
    const row: ConsentRecord = ConsentRecordSchema.parse({
      id: uuidv7(),
      userId: input.userId,
      purpose,
      version: input.version,
      action: "grant",
      timestamp: new Date().toISOString(),
      evidenceHash: input.evidenceHash,
      source: input.source,
      ip_hash: input.ip_hash ?? "",
    });
    this.#append(row);
    return row;
  }

  async revoke(input: RevokeInput): Promise<ConsentRecord> {
    const purpose = ConsentPurposeSchema.parse(input.purpose);
    const desc = DEFAULT_PURPOSE_REGISTRY[purpose];
    if (!desc.revocable) {
      throw new ConsentNotRevocableError(purpose);
    }
    const ev = await evidenceHash({ purpose, action: "revoke", reason: input.reason ?? null });
    const row: ConsentRecord = ConsentRecordSchema.parse({
      id: uuidv7(),
      userId: input.userId,
      purpose,
      version: desc.version,
      action: "revoke",
      timestamp: new Date().toISOString(),
      evidenceHash: ev,
      source: input.source ?? "web",
      ip_hash: input.ip_hash ?? "",
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });
    this.#append(row);
    return row;
  }

  async effectiveConsents(userId: string): Promise<EffectiveConsent[]> {
    const rows = this.#byUser.get(userId) ?? [];
    const latest = new Map<ConsentPurpose, ConsentRecord>();
    for (const r of rows) latest.set(r.purpose, r);
    const out: EffectiveConsent[] = [];
    for (const [purpose, r] of latest) {
      const granted = r.action === "grant";
      const latestNotice = DEFAULT_PURPOSE_REGISTRY[purpose].version;
      const stale = granted && r.version !== latestNotice;
      out.push({
        purpose,
        granted,
        version: r.version,
        at: r.timestamp,
        ...(stale ? { staleAgainst: latestNotice } : {}),
      });
    }
    return out.sort((a, b) => a.purpose.localeCompare(b.purpose));
  }

  async requiresReConsent(
    userId: string,
    latest: Record<ConsentPurpose, string>,
  ): Promise<ConsentPurpose[]> {
    const eff = await this.effectiveConsents(userId);
    const need: ConsentPurpose[] = [];
    for (const e of eff) {
      const want = latest[e.purpose];
      if (e.granted && want && want !== e.version) need.push(e.purpose);
    }
    return need;
  }

  async getConsentLog(userId: string): Promise<ConsentRecord[]> {
    return [...(this.#byUser.get(userId) ?? [])];
  }

  async hasEffective(userId: string, purpose: ConsentPurpose): Promise<boolean> {
    const rows = this.#byUser.get(userId) ?? [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r && r.purpose === purpose) return r.action === "grant";
    }
    // No record. Necessary purposes default to granted (contract basis);
    // optional purposes default to denied.
    const desc = DEFAULT_PURPOSE_REGISTRY[purpose];
    return desc.necessary && desc.legal_basis === "contract";
  }

  /** Test helper — total row count, used by integrity tests. */
  size(): number {
    return this.#rows.length;
  }

  #append(row: ConsentRecord): void {
    this.#rows.push(row);
    const arr = this.#byUser.get(row.userId) ?? [];
    arr.push(row);
    this.#byUser.set(row.userId, arr);
  }
}

export class ConsentNotRevocableError extends Error {
  readonly code = "CONSENT_NOT_REVOCABLE";
  readonly purpose: ConsentPurpose;
  constructor(purpose: ConsentPurpose) {
    super(`Purpose ${purpose} is necessary for the contract and cannot be revoked while it is active.`);
    this.name = "ConsentNotRevocableError";
    this.purpose = purpose;
  }
}

/** Convenience helper used by the API: build the evidence hash for what the
 *  user actually saw at consent time — the descriptor plus the locale string
 *  rendered to them. */
export async function buildEvidenceHash(
  desc: PurposeDescriptor,
  locale: string,
  shownText: string,
): Promise<string> {
  return evidenceHash({
    purpose: desc.purpose,
    version: desc.version,
    legal_basis: desc.legal_basis,
    locale,
    shown: shownText,
  });
}

// =============================================================================
// PII redaction — between app and any LLM prompt or log line.
//
// References:
//   docs/research/security.md §4 LLM02 (sensitive info disclosure)
//   docs/research/security.md §7 (asset table)
//   UIDAI Aadhaar enrolment specification (Verhoeff check digit)
//   Income Tax Act PAN format §139A
//   ISO 3779 (VIN)
//   Indian state/UT VRN scheme (CMVR + state RTO codes)
//   IFSC: RBI master direction; 4-letter bank code + 0 + 6-char branch.
//   Luhn (ISO/IEC 7812-1:2017) for credit-card check digits.
//
// Redactors are O(1) per token — every regex is anchored and precompiled
// at module load. The order is fixed so longer matches (Aadhaar 12-digit,
// VIN 17-char) get a chance before generic phone matches.
//
// Two modes:
//   redactForLog(obj)  — replaces every match with `[REDACTED:<type>]`.
//   redactForLLM(obj)  — same, plus rounds GPS coordinates to ~1 km grid
//                        (4 decimal places truncated to 2; ~1.1 km in
//                        India at typical latitudes).
// =============================================================================

import { z } from "zod";

export type RedactionTag =
  | "email"
  | "phone-in"
  | "aadhaar"
  | "pan"
  | "vrn"
  | "vin"
  | "ip"
  | "gps"
  | "credit-card"
  | "bank-account"
  | "ifsc";

export interface RedactionOptions {
  /** When true, GPS coordinates are quantised to ~1 km grid instead of fully redacted. */
  gpsQuantise?: boolean;
}

// -----------------------------------------------------------------------------
// Verhoeff (Aadhaar) — RFC-compliant table-based check.
// -----------------------------------------------------------------------------

const VERHOEFF_D: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let c = 0;
  const reversed = num.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    const d = Number(reversed[i]!);
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![d]!]!;
  }
  return c === 0;
}

// -----------------------------------------------------------------------------
// Luhn (credit-card)
// -----------------------------------------------------------------------------

export function luhnValid(num: string): boolean {
  const digits = num.replace(/\s|-/g, "");
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]!);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// -----------------------------------------------------------------------------
// Indian VRN — state code (2 letters) + RTO code (1-3 digits) + series (0-3 letters) + 4 digits
// Real CMVR pattern: e.g. HR26DK8337, MH12AB1234, KA01AA1234.
// -----------------------------------------------------------------------------

const STATE_CODES = new Set([
  "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR",
  "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "OR",
  "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK", "UP", "WB",
]);

// -----------------------------------------------------------------------------
// VIN — 17 chars, ISO 3779. Excludes I, O, Q.
// -----------------------------------------------------------------------------
const VIN_REGEX = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

// -----------------------------------------------------------------------------
// Email — RFC 5322 simplified
// -----------------------------------------------------------------------------
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// -----------------------------------------------------------------------------
// Indian phone — +91 followed by 10-digit, or bare 10-digit starting 6/7/8/9.
// We require word boundaries on both ends to avoid eating account numbers.
// -----------------------------------------------------------------------------
const PHONE_91_REGEX = /(?<![\d])\+91[\s-]?[6-9]\d{9}(?![\d])/g;
const PHONE_BARE_REGEX = /(?<![\d])[6-9]\d{9}(?![\d])/g;

// -----------------------------------------------------------------------------
// Aadhaar — 12 digits, optionally 4-4-4 grouped.
// -----------------------------------------------------------------------------
const AADHAAR_REGEX = /(?<![\d])\d{4}[\s-]?\d{4}[\s-]?\d{4}(?![\d])/g;

// -----------------------------------------------------------------------------
// PAN — 5 letters + 4 digits + 1 letter
// -----------------------------------------------------------------------------
const PAN_REGEX = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

// -----------------------------------------------------------------------------
// IFSC — 4 letters + '0' + 6 alphanumerics. RBI master direction.
// -----------------------------------------------------------------------------
const IFSC_REGEX = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;

// -----------------------------------------------------------------------------
// Indian VRN — captures e.g. MH12AB1234. We tighten the state-code check below.
// -----------------------------------------------------------------------------
const VRN_REGEX = /\b([A-Z]{2})\d{1,3}[A-Z]{0,3}\d{4}\b/g;

// -----------------------------------------------------------------------------
// IPv4 + IPv6
// -----------------------------------------------------------------------------
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;
const IPV6_REGEX = /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g;

// -----------------------------------------------------------------------------
// GPS lat/lng — `lat: 28.6139, lng: 77.2090` or `28.6139, 77.2090`.
// -----------------------------------------------------------------------------
const GPS_REGEX = /(?<![\d.])-?(?:[0-8]?\d|90)\.\d{3,}\s*,\s*-?(?:1?[0-7]?\d|180)\.\d{3,}(?![\d.])/g;

// -----------------------------------------------------------------------------
// Credit-card — 12-19 digits with optional spaces/dashes; Luhn-checked at match.
// -----------------------------------------------------------------------------
const CARD_REGEX = /(?<![\d])(?:\d[\s-]?){12,19}(?![\d])/g;

// -----------------------------------------------------------------------------
// Indian bank-account — 9-18 digits flanked by word boundaries (and no
// embedding context that suggests phone/Aadhaar). Used after the more
// specific extractors above, so they win on overlap.
// -----------------------------------------------------------------------------
const BANK_ACCOUNT_REGEX = /(?<![\d])\d{9,18}(?![\d])/g;

export interface RedactionEngine {
  redactForLog(value: unknown): unknown;
  redactForLLM(value: unknown): unknown;
  redactString(value: string, opts?: RedactionOptions): string;
}

function tag(t: RedactionTag): string {
  return `[REDACTED:${t}]`;
}

function quantiseGps(match: string): string {
  const parts = match.split(",").map((p) => p.trim());
  if (parts.length !== 2) return tag("gps");
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return tag("gps");
  const qLat = Math.trunc(lat * 100) / 100;
  const qLng = Math.trunc(lng * 100) / 100;
  return `[GPS~${qLat.toFixed(2)},${qLng.toFixed(2)}]`;
}

function redactStringInner(input: string, opts: RedactionOptions): string {
  let s = input;

  // Email — done first; an email never overlaps a digits-only run.
  s = s.replace(EMAIL_REGEX, tag("email"));

  // VIN — 17 chars, longest digits-or-letters run; before plate/account.
  s = s.replace(VIN_REGEX, tag("vin"));

  // Phone — +91 form first to avoid the bare 10-digit eating it.
  s = s.replace(PHONE_91_REGEX, tag("phone-in"));

  // Aadhaar — only matches if Verhoeff valid.
  s = s.replace(AADHAAR_REGEX, (m) => {
    const digits = m.replace(/\s|-/g, "");
    return verhoeffValid(digits) ? tag("aadhaar") : m;
  });

  // PAN
  s = s.replace(PAN_REGEX, tag("pan"));

  // IFSC
  s = s.replace(IFSC_REGEX, tag("ifsc"));

  // VRN — state code allow-listed.
  s = s.replace(VRN_REGEX, (m, state: string) => (STATE_CODES.has(state) ? tag("vrn") : m));

  // IPv4
  s = s.replace(IPV4_REGEX, tag("ip"));

  // IPv6 — only when there's at least one colon group.
  s = s.replace(IPV6_REGEX, (m) => (m.includes(":") ? tag("ip") : m));

  // GPS — quantise for LLM, full redact for log.
  s = s.replace(GPS_REGEX, (m) => (opts.gpsQuantise ? quantiseGps(m) : tag("gps")));

  // Credit card — Luhn-checked.
  s = s.replace(CARD_REGEX, (m) => {
    const digits = m.replace(/\s|-/g, "");
    if (digits.length < 12) return m;
    return luhnValid(digits) ? tag("credit-card") : m;
  });

  // Bare 10-digit Indian phone (after email/VIN/aadhaar consumed).
  s = s.replace(PHONE_BARE_REGEX, tag("phone-in"));

  // Bank account — last, only redacts ungrouped 9-18 digit runs.
  s = s.replace(BANK_ACCOUNT_REGEX, tag("bank-account"));

  return s;
}

function deepWalk<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as unknown as T;
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => deepWalk(v, fn)) as unknown as T;
  if (value instanceof Date) return value;
  if (value instanceof Uint8Array) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const sk = fn(k);
    out[sk] = deepWalk(v, fn);
  }
  return out as unknown as T;
}

export function makeRedactionEngine(): RedactionEngine {
  return {
    redactForLog(value: unknown): unknown {
      return deepWalk(value, (s) => redactStringInner(s, { gpsQuantise: false }));
    },
    redactForLLM(value: unknown): unknown {
      return deepWalk(value, (s) => redactStringInner(s, { gpsQuantise: true }));
    },
    redactString(value: string, opts: RedactionOptions = {}): string {
      return redactStringInner(value, { gpsQuantise: opts.gpsQuantise ?? false });
    },
  };
}

// Schema for callers that want to validate an already-redacted payload (e.g.
// a test harness asserting nothing slipped through).
export const RedactedTagPattern = /\[REDACTED:[a-z-]+\]|\[GPS~-?\d+\.\d+,-?\d+\.\d+\]/;
export const RedactedSchema = z
  .string()
  .refine((s) => RedactedTagPattern.test(s), { message: "no redaction tag found" });

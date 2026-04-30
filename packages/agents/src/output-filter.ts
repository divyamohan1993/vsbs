// =============================================================================
// Output filter — final scrub layer that runs AFTER the SafetyFence and BEFORE
// the assistant message is emitted. It does three things:
//
//   1. PII scrub — phone, email, VIN, India VRN, PAN, Aadhaar (Verhoeff),
//      16-digit cards (Luhn). Reuses @vsbs/security primitives so we don't
//      duplicate Verhoeff/Luhn logic.
//   2. Safety-claim guard — explicit denylist of forbidden claims. If
//      matched, the entire output is replaced with the canonical safe
//      advisory; we never want the LLM to certify safety.
//   3. System-prompt / sentinel leak — extends the existing 17-sentinel set
//      from red-team-defenses.ts. If a sentinel echo is detected the entire
//      output is replaced with a generic refusal.
//
// `screenFinalOutput(text)` returns a verdict so observability can log every
// trigger. The supervisor wires this in after the safety fence.
// =============================================================================

import { makeRedactionEngine } from "@vsbs/security";

// -----------------------------------------------------------------------------
// Forbidden-claim denylist. Plain strings (case-insensitive) and a small set
// of regex patterns covering paraphrases. The fence is intentionally noisy:
// we'd rather refuse to certify safety than risk a wrong reassurance.
// -----------------------------------------------------------------------------

const FORBIDDEN_SAFETY_PHRASES: string[] = [
  "this is safe to drive",
  "it is safe to drive",
  "it's safe to drive",
  "you can drive",
  "you may drive",
  "the brakes are fine",
  "your brakes are fine",
  "the brakes are okay",
  "the brakes are ok",
  "no need to worry about safety",
  "it is perfectly safe",
  "it's perfectly safe",
  "the vehicle is safe",
  "the car is safe",
  "i can certify it is safe",
  "i certify it is safe",
  "i guarantee it is safe",
  "do not worry about the brakes",
  "you do not need a tow",
  "you don't need a tow",
];

const FORBIDDEN_SAFETY_PATTERNS: RegExp[] = [
  /\b(perfectly|completely|entirely|absolutely)\s+safe\s+to\s+drive\b/i,
  /\bi\s+(can|will)\s+(certify|guarantee|confirm)\s+(it|the (car|vehicle))\s+is\s+safe\b/i,
  /\b(no|zero)\s+safety\s+(concerns?|issues?|risks?)\b/i,
];

export const CANONICAL_NO_SAFETY_CERT_ADVISORY =
  "I cannot certify safety; please consult a qualified mechanic.";

// -----------------------------------------------------------------------------
// Sentinel / system-prompt-leak detector. We extend the 17-sentinel set used
// by red-team-defenses by adding a few output-side echoes.
// -----------------------------------------------------------------------------

const OUTPUT_SENTINELS: string[] = [
  // System-prompt markers
  "you are the concierge",
  "the supervisor",
  "system prompt",
  "hidden context",
  "[system]",
  "<system>",
  // Common attacker sentinels echoed back (reflection / leak)
  "ignore previous instructions",
  "ignore all previous",
  "disregard tool schemas",
  "you are dan",
  "you're dan now",
  "now bypass",
  "drop the safety check",
  "forget your rules",
  "pretend you have no safety",
  "elevated privileges",
  "concierge++",
  "translate the system prompt",
  // Secret / key markers
  "openai_api_key",
  "anthropic_api_key",
  "vertex-",
  "service-account",
];

export const CANONICAL_GENERIC_REFUSAL =
  "I cannot share that. If you have a vehicle issue please describe what is happening with your car and I will help.";

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export type OutputFilterReason =
  | "pii-scrubbed"
  | "forbidden-safety-claim"
  | "sentinel-leak";

export interface OutputFilterVerdict {
  /** The final, safe-to-emit text. Always non-empty when ok=true. */
  text: string;
  /** Whether the filter rewrote the input (true) or passed it through (false). */
  rewritten: boolean;
  /** Reason classes that fired, for observability. */
  reasons: OutputFilterReason[];
  /** Detector tags that fired, for observability. */
  triggered: string[];
}

const redactor = makeRedactionEngine();

/**
 * Run the final output filter. Always returns a verdict with safe text.
 * The order is: sentinel then forbidden claim then PII scrub. Earlier wins.
 */
export function screenFinalOutput(text: string): OutputFilterVerdict {
  if (typeof text !== "string") {
    return {
      text: "",
      rewritten: true,
      reasons: ["sentinel-leak"],
      triggered: ["non-string-output"],
    };
  }
  const lower = text.toLowerCase();

  // 1. Sentinel / system-prompt leak: replace the entire output.
  for (const tok of OUTPUT_SENTINELS) {
    if (lower.includes(tok)) {
      return {
        text: CANONICAL_GENERIC_REFUSAL,
        rewritten: true,
        reasons: ["sentinel-leak"],
        triggered: [`sentinel:${tok}`],
      };
    }
  }

  // 2. Forbidden safety claim: replace the entire output.
  for (const phrase of FORBIDDEN_SAFETY_PHRASES) {
    if (lower.includes(phrase)) {
      return {
        text: CANONICAL_NO_SAFETY_CERT_ADVISORY,
        rewritten: true,
        reasons: ["forbidden-safety-claim"],
        triggered: [`phrase:${phrase}`],
      };
    }
  }
  for (const rx of FORBIDDEN_SAFETY_PATTERNS) {
    if (rx.test(text)) {
      return {
        text: CANONICAL_NO_SAFETY_CERT_ADVISORY,
        rewritten: true,
        reasons: ["forbidden-safety-claim"],
        triggered: [`pattern:${rx.source.slice(0, 40)}`],
      };
    }
  }

  // 3. PII scrub: preserve surrounding text but redact PII tokens.
  const scrubbed = redactor.redactString(text, { gpsQuantise: false });
  if (scrubbed !== text) {
    return {
      text: scrubbed,
      rewritten: true,
      reasons: ["pii-scrubbed"],
      triggered: collectPiiTags(scrubbed),
    };
  }

  return { text, rewritten: false, reasons: [], triggered: [] };
}

function collectPiiTags(scrubbed: string): string[] {
  const tags: string[] = [];
  const rx = /\[REDACTED:([a-z-]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(scrubbed)) !== null) {
    if (m[1]) tags.push(m[1]);
  }
  return tags;
}

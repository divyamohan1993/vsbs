// =============================================================================
// @vsbs/security — quantum-secure, defense-in-depth primitives.
//
// References:
//   docs/research/security.md (research synthesis)
//   docs/security/threat-model.md (STRIDE for autonomous handoff)
//   docs/security/keys.md (key inventory + rotation schedule)
//
// Phase 6 of docs/roadmap-prod-deploy.md.
// =============================================================================

export * from "./pq.js";
export * from "./sig.js";
export * from "./kms-envelope.js";
export * from "./webauthn.js";
export * from "./command-grant-passkey.js";
export * from "./secrets.js";
export * from "./pii-redaction.js";
export * from "./csp.js";
export * from "./rate-limit.js";
export * from "./release-signing.js";
export * from "./key-ceremony.js";

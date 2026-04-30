// =============================================================================
// @vsbs/agents — AI-safety facade. Re-exports the safety primitives so a
// consumer can `import { SafetyFence, screenFinalOutput, ... } from "@vsbs/agents/ai-safety"`
// (or via the package index) without depending on internal layout.
//
// This file is intentionally a thin barrel — every export here has a home
// module that owns its tests. Do NOT add new logic here.
// =============================================================================

export {
  SafetyFence,
  safetyFence,
  CANONICAL_RED_FLAG_ADVISORY,
  CANONICAL_DO_NOT_DRIVE_ADVISORY,
  extractRedFlagsFromUserMessage,
  extractSensorFlagsFromToolResults,
  looksLikeDriveSuggestion,
  type SafetyFenceContext,
  type SafetyFenceVerdict,
} from "./llm-safety-fence.js";

export {
  ConfidenceFloor,
  ToolResultEnvelopeMetadataSchema,
  ToolResultEnvelopeSchema,
  envelope,
  isEnvelope,
  unwrapForLegacyCallers,
  runConfidenceGate,
  CANONICAL_LOW_CONFIDENCE_ADVISORY,
  type ToolResultEnvelope,
  type ToolResultEnvelopeMetadata,
  type ConfidenceGateVerdict,
} from "./confidence.js";

export {
  screenFinalOutput,
  CANONICAL_NO_SAFETY_CERT_ADVISORY,
  CANONICAL_GENERIC_REFUSAL,
  type OutputFilterReason,
  type OutputFilterVerdict,
} from "./output-filter.js";

export {
  MemoryScope,
  MemoryScopeSchema,
  SignedDeletionRecordSchema,
  InMemoryScopedStore,
  generateLocalWitnessKey,
  canonicalize,
  verifySignedDeletionRecord,
  revokeMemoryForOwner,
  type ScopedKey,
  type ScopedFact,
  type ScopedFactWrite,
  type ScopedMemoryStore,
  type SignedDeletionRecord,
  type WitnessKey,
  type PromotionRecord,
} from "./memory-scope.js";

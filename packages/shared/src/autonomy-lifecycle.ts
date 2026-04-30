// =============================================================================
// Autonomy lifecycle — single import surface for the runtime layer.
//
// Coordinator-side integration imports from this module to keep the public
// surface tight: the API server, agent tools, and adapter wiring all pull
// schemas, types, and verifier functions through here. The underlying
// modules (grant-heartbeat, grant-offline, grant-dual-control, the signed
// catalogue extensions in autonomy-registry) remain individually
// importable for unit-test scope.
// =============================================================================

export {
  HeartbeatPolicySchema,
  HeartbeatRunner,
  FakeHeartbeatClock,
  liveHeartbeatClock,
  type HeartbeatPolicy,
  type HeartbeatEvaluation,
  type HeartbeatEvaluator,
  type HeartbeatRevocation,
  type HeartbeatRevocationHook,
  type HeartbeatClock,
} from "./grant-heartbeat.js";

export {
  OFFLINE_GRANT_MAX_TTL_MS,
  OfflineGrantEnvelopeSchema,
  mintOfflineEnvelope,
  verifyOfflineEnvelope,
  permitOfflineAction,
  generateWitnessKeypair,
  type OfflineGrantEnvelope,
  type OfflineAction,
  type WitnessSigningKey,
  type WitnessVerifyingKey,
  type WitnessKeyResolver,
  type MintOfflineEnvelopeInput,
  type OfflineEnvelopeVerifyResult,
  type PermitOfflineActionInput,
  type PermitOfflineActionResult,
} from "./grant-offline.js";

export {
  DualControlRoleSchema,
  DualControlPolicySchema,
  DualControlSignatureSchema,
  OffPlatformAuditEntrySchema,
  assembleDualControlGrant,
  recordOffPlatformAudit,
  InMemoryOffPlatformSink,
  NotConfiguredOffPlatformSink,
  type DualControlRole,
  type DualControlPolicy,
  type DualControlSignature,
  type DualControlPublicKey,
  type DualControlKeyResolver,
  type DualControlAssembleResult,
  type OffPlatformAuditEntry,
  type OffPlatformAuditReceipt,
  type OffPlatformAuditSink,
} from "./grant-dual-control.js";

export {
  SignedGeofenceEntrySchema,
  SignedGeofenceCatalogueSchema,
  signGeofenceEntry,
  verifyGeofenceEntry,
  loadVerifiedCatalogue,
  resolveAutonomyCapabilityV3,
  type SignedGeofenceEntry,
  type SignedGeofenceCatalogue,
  type GeofenceWitnessSigningKey,
  type GeofenceWitnessVerifyingKey,
  type GeofenceKeyResolver,
  type GeofenceVerifyResult,
  type GeofenceValidity,
  type RejectedGeofenceEntry,
  type VerifiedCatalogueResult,
} from "./autonomy-registry-signing.js";

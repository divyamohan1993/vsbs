// Hard limits used across the system. Changing any of these changes
// product behaviour — every constant is cited to where the decision was
// made.

/** Maximum lifetime of any autonomous CommandGrant. See docs/research/autonomy.md §5. */
export const AUTONOMY_MAX_GRANT_SECONDS = 6 * 60 * 60;

/** Maximum radius (metres) for a single CommandGrant geofence. */
export const AUTONOMY_MAX_GEOFENCE_METERS = 50_000;

/** Maximum audio clip length customers can upload for a noise report. */
export const AUDIO_UPLOAD_MAX_SECONDS = 30;

/** Max image size per upload. Enforced on both client and server. */
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Service center utilisation above which we penalise in the dispatch objective. See docs/research/dispatch.md §3. */
export const SERVICE_CENTER_UTIL_PENALTY_THRESHOLD = 0.75;

/** Distance above which we prefer a mobile mechanic for an amber issue. See docs/research/dispatch.md §4. */
export const AMBER_MOBILE_PREFERRED_KM = 30;

/** Maximum drive-in distance we will suggest, regardless of severity. */
export const MAX_DRIVE_IN_KM = 25;

/** Maximum drive-in travel time we will suggest. */
export const MAX_DRIVE_IN_MINUTES = 45;

/** Takeover alert escalation window (seconds). See docs/research/prognostics.md §4. */
export const TAKEOVER_ESCALATION_SECONDS = 10;

/** Grant ping frequency for revocation. See docs/research/autonomy.md §5. */
export const GRANT_REVOCATION_PING_SECONDS = 10;

/** Cool-off window (seconds) during which an auto-paid transaction can be reversed without manual approval. */
export const AUTOPAY_COOL_OFF_SECONDS = 15 * 60;

/** Weights for the dispatch objective — see docs/research/dispatch.md §3. */
export const DISPATCH_OBJECTIVE_WEIGHTS = {
  travel: 1.0,
  wait: 1.5,
  loadBalance: 0.8,
  cost: 0.3,
  wellbeing: 2.5,
  historicalCsat: 1.2,
} as const;

/** Composite Wellbeing Score weights — see docs/research/wellbeing.md §2. */
export const WELLBEING_WEIGHTS = {
  safety: 0.25,
  wait: 0.15,
  cti: 0.12,
  timeAccuracy: 0.1,
  servqual: 0.1,
  trust: 0.08,
  continuity: 0.08,
  ces: 0.05,
  csat: 0.04,
  nps: 0.03,
} as const;

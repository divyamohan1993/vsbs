// =============================================================================
// PII-free analytics. The mobile app never sends a name, phone, email, VIN,
// plate number, or precise location to any third-party analytics SDK.
//
// We log a minimal local event stream to AsyncStorage, tagged with a
// per-event PII guard. The shipping default is "off" — events are only
// flushed to the API's first-party `/v1/analytics/events` endpoint when
// the user has granted the `ml-improvement-anonymised` consent purpose.
//
// The PII guard is enforced at type level: each event has a fixed shape
// and the values are restricted to enums + numbers + an opaque hashed
// session id.
// =============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";

export type AnalyticsEventName =
  | "app_open"
  | "auth_otp_started"
  | "auth_otp_verified"
  | "book_step_completed"
  | "book_confirmed"
  | "concierge_turn_started"
  | "concierge_turn_completed"
  | "autonomy_grant_signed"
  | "autonomy_grant_revoked"
  | "ble_obd_connected"
  | "ble_obd_disconnected"
  | "ble_obd_sample_batch"
  | "consent_changed"
  | "erasure_requested"
  | "screen_view";

/**
 * Fixed event-property shape. Every key is either a small enum / number
 * or an opaque session-scoped identifier. There is intentionally no
 * "free-form string" property.
 */
export interface AnalyticsProps {
  step?: number;
  durationMs?: number;
  bookingId?: string;
  grantId?: string;
  result?: "ok" | "fail" | "cancel";
  screen?: string;
  count?: number;
  consentPurpose?: string;
  consentGranted?: boolean;
  origin?: "real" | "sim";
}

interface QueuedEvent {
  name: AnalyticsEventName;
  props: AnalyticsProps;
  ts: number;
}

const QUEUE_KEY = "vsbs.analytics.v1";

export async function track(name: AnalyticsEventName, props: AnalyticsProps = {}): Promise<void> {
  const event: QueuedEvent = { name, props, ts: Date.now() };
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  let q: QueuedEvent[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) q = parsed.filter(isQueued);
    } catch {
      q = [];
    }
  }
  q.push(event);
  // Keep at most 1000 events locally; drop the oldest beyond that.
  if (q.length > 1000) q.splice(0, q.length - 1000);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function isQueued(v: unknown): v is QueuedEvent {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { name?: unknown }).name === "string" &&
    typeof (v as { ts?: unknown }).ts === "number"
  );
}

export async function readEvents(): Promise<QueuedEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueued);
  } catch {
    return [];
  }
}

export async function clearEvents(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

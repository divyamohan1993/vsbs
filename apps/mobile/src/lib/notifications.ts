// =============================================================================
// Push notifications via Firebase Cloud Messaging.
//
// Expo's `expo-notifications` module wraps APNs (iOS) and FCM (Android).
// We:
//
//   1. Register the device for a platform push token.
//   2. POST the token to /v1/notifications/register so the API can fan
//      out booking + autonomy events.
//   3. Listen for incoming notifications. Each notification carries an
//      HMAC-SHA-256 signature (`sig`) over a canonical payload using a
//      device-shared key established at register-time. We verify the HMAC
//      before doing anything user-visible. A failed verification is
//      logged + dropped.
//
// The five notification kinds we expect:
//   booking-state-changed
//   autonomy-grant-issued
//   autonomy-grant-expiring (T-5min)
//   payment-required
//   service-complete
//
// PII rule: the notification body never contains the owner's name, phone,
// or VIN. We pass an opaque booking id and the body string is composed
// from `data.kind` + i18n on the device.
// =============================================================================

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod";

import { apiClient } from "./api";

const HMAC_KEY_STORAGE = "vsbs.notifications.hmac";

export const NotificationPayloadSchema = z.object({
  kind: z.enum([
    "booking-state-changed",
    "autonomy-grant-issued",
    "autonomy-grant-expiring",
    "payment-required",
    "service-complete",
  ]),
  bookingId: z.string().uuid().optional(),
  grantId: z.string().uuid().optional(),
  ts: z.string().datetime(),
  sig: z.string().min(1),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "VSBS",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#5a8dee",
    });
    await Notifications.setNotificationChannelAsync("autonomy", {
      name: "Autonomy",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: "#a8131a",
    });
  }

  const settings = await Notifications.getPermissionsAsync();
  let granted = settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) {
    const ask = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true, allowDisplayInCarPlay: false },
    });
    granted = ask.granted;
  }
  if (!granted) return null;

  const tokenResult = await Notifications.getDevicePushTokenAsync();
  const token = typeof tokenResult.data === "string" ? tokenResult.data : JSON.stringify(tokenResult.data);

  const registered = await apiClient.request(
    "/v1/notifications/register",
    z.object({ ok: z.literal(true), hmacKeyB64: z.string().min(16) }),
    {
      method: "POST",
      body: { token, platform: Platform.OS },
    },
  );
  await SecureStore.setItemAsync(HMAC_KEY_STORAGE, registered.hmacKeyB64);
  return token;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i]! ^ b[i]!;
  return r === 0;
}

/**
 * Verify a notification's HMAC signature against the server-issued key.
 * Returns false on any failure (missing key, malformed payload, mismatch).
 */
export async function verifyNotificationSignature(payload: NotificationPayload): Promise<boolean> {
  const keyB64 = await SecureStore.getItemAsync(HMAC_KEY_STORAGE);
  if (!keyB64) return false;
  const keyBytes = fromBase64(keyB64);

  const canonical = JSON.stringify({
    kind: payload.kind,
    bookingId: payload.bookingId ?? null,
    grantId: payload.grantId ?? null,
    ts: payload.ts,
  });
  const enc = new TextEncoder().encode(canonical);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc as unknown as ArrayBuffer);
  const mac = new Uint8Array(macBuf);
  const presented = fromBase64(payload.sig);
  return constantTimeEquals(mac, presented);
}

export type NotificationHandler = (payload: NotificationPayload) => void | Promise<void>;

/** Subscribe to incoming notifications; verifies signature before invoking. */
export function subscribeNotifications(handler: NotificationHandler): () => void {
  const sub = Notifications.addNotificationReceivedListener(async (event) => {
    const dataUnknown = event.request.content.data;
    const parsed = NotificationPayloadSchema.safeParse(dataUnknown);
    if (!parsed.success) {
      console.warn("[notifications] schema mismatch — dropping");
      return;
    }
    const ok = await verifyNotificationSignature(parsed.data);
    if (!ok) {
      console.warn("[notifications] hmac mismatch — dropping");
      return;
    }
    await handler(parsed.data);
  });
  return () => sub.remove();
}

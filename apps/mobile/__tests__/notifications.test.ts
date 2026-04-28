

const secureStore = new Map<string, string>();

jest.mock("expo-notifications", () => ({
  __esModule: true,
  setNotificationHandler: jest.fn(),
  AndroidImportance: { HIGH: 4, MAX: 5 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove() {} })),
}));

jest.mock("expo-device", () => ({ __esModule: true, isDevice: false }));

jest.mock("expo-secure-store", () => ({
  __esModule: true,
  getItemAsync: (k: string) => Promise.resolve(secureStore.get(k) ?? null),
  setItemAsync: (k: string, v: string) => {
    secureStore.set(k, v);
    return Promise.resolve();
  },
  deleteItemAsync: (k: string) => {
    secureStore.delete(k);
    return Promise.resolve();
  },
}));

jest.mock("react-native", () => ({ __esModule: true, Platform: { OS: "ios" } }));

jest.mock("../src/lib/region", () => ({
  resolveBaseUrl: () => Promise.resolve("http://localhost:8787"),
}));

import { NotificationPayloadSchema, verifyNotificationSignature } from "../src/lib/notifications";

describe("NotificationPayloadSchema", () => {
  it("accepts a valid booking-state-changed payload", () => {
    const ok = NotificationPayloadSchema.safeParse({
      kind: "booking-state-changed",
      bookingId: "11111111-1111-4111-8111-111111111111",
      ts: "2026-04-15T10:00:00.000Z",
      sig: "abc==",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const bad = NotificationPayloadSchema.safeParse({
      kind: "unknown",
      ts: "2026-04-15T10:00:00.000Z",
      sig: "x",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a payload with no signature", () => {
    const bad = NotificationPayloadSchema.safeParse({
      kind: "service-complete",
      ts: "2026-04-15T10:00:00.000Z",
      sig: "",
    });
    expect(bad.success).toBe(false);
  });

  it("verifyNotificationSignature returns false when no key has been provisioned", async () => {
    secureStore.clear();
    const ok = await verifyNotificationSignature({
      kind: "service-complete",
      ts: "2026-04-15T10:00:00.000Z",
      sig: "ZmFrZQ==",
    });
    expect(ok).toBe(false);
  });

  it("verifyNotificationSignature returns true for a correctly-HMAC'd payload", async () => {
    // Provision a 32-byte key and compute the expected HMAC ourselves.
    const keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) keyBytes[i] = i;
    const keyB64 = Buffer.from(keyBytes).toString("base64");
    secureStore.set("vsbs.notifications.hmac", keyB64);

    const payload = {
      kind: "service-complete" as const,
      ts: "2026-04-15T10:00:00.000Z",
    };
    const canonical = JSON.stringify({
      kind: payload.kind,
      bookingId: null,
      grantId: null,
      ts: payload.ts,
    });
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const macBuf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(canonical));
    const sig = Buffer.from(new Uint8Array(macBuf)).toString("base64");
    const ok = await verifyNotificationSignature({ ...payload, sig });
    expect(ok).toBe(true);
  });
});

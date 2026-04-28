// Jest setup. Ensures globalThis.crypto.subtle exists for tests that
// exercise the canonical-grant signing helpers from @vsbs/shared. Node 22
// already provides webcrypto on globalThis.crypto; this guard keeps the
// suite portable to older runners.
const { webcrypto } = require("node:crypto");

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// Polyfill TextEncoder/TextDecoder if missing.
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("node:util");
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// Provide a minimal atob/btoa for environments where they are absent.
if (typeof globalThis.atob === "undefined") {
  globalThis.atob = (b) => Buffer.from(b, "base64").toString("binary");
}
if (typeof globalThis.btoa === "undefined") {
  globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
}

// Mock the Expo / RN modules that we never need in pure-logic tests.
// Tests that *do* exercise these modules override the mock at the file
// level via jest.mock(). These globals just keep `import * from ...` from
// crashing on ESM-only Expo packages whose source uses `import` syntax.
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    __esModule: true,
    getItemAsync: (k) => Promise.resolve(store.get(k) ?? null),
    setItemAsync: (k, v) => {
      store.set(k, v);
      return Promise.resolve();
    },
    deleteItemAsync: (k) => {
      store.delete(k);
      return Promise.resolve();
    },
  };
});

jest.mock("expo-localization", () => ({
  __esModule: true,
  getLocales: () => [{ regionCode: "IN", languageCode: "en" }],
  getCalendars: () => [{ timeZone: "Asia/Kolkata" }],
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} }, manifest2: { extra: {} } },
}));

jest.mock("expo-device", () => ({ __esModule: true, isDevice: false }));

jest.mock("expo-local-authentication", () => ({
  __esModule: true,
  hasHardwareAsync: () => Promise.resolve(false),
  isEnrolledAsync: () => Promise.resolve(false),
  authenticateAsync: () => Promise.resolve({ success: false }),
}));

jest.mock("expo-notifications", () => ({
  __esModule: true,
  setNotificationHandler: () => undefined,
  setNotificationChannelAsync: () => Promise.resolve(),
  getPermissionsAsync: () => Promise.resolve({ granted: false, ios: { status: 0 } }),
  requestPermissionsAsync: () => Promise.resolve({ granted: false }),
  getDevicePushTokenAsync: () => Promise.resolve({ data: "stub", type: "ios" }),
  addNotificationReceivedListener: () => ({ remove() {} }),
  AndroidImportance: { HIGH: 4, MAX: 5 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));

jest.mock("expo-camera", () => ({ __esModule: true, CameraView: class {} }));
jest.mock("expo-av", () => ({
  __esModule: true,
  Audio: {
    requestPermissionsAsync: () => Promise.resolve({ status: "denied" }),
    setAudioModeAsync: () => Promise.resolve(),
    Recording: class {
      prepareToRecordAsync() { return Promise.resolve(); }
      startAsync() { return Promise.resolve(); }
      stopAndUnloadAsync() { return Promise.resolve(); }
      getURI() { return "file:///stub.m4a"; }
    },
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

jest.mock("react-native-passkey", () => ({
  __esModule: true,
  Passkey: { isSupported: () => false, create: () => Promise.reject(new Error("stub")), get: () => Promise.reject(new Error("stub")) },
}));

jest.mock("react-native-ble-plx", () => ({
  __esModule: true,
  BleManager: class {},
}));

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: (k) => Promise.resolve(store.get(k) ?? null),
      setItem: (k, v) => {
        store.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k) => {
        store.delete(k);
        return Promise.resolve();
      },
      multiRemove: (keys) => {
        for (const k of keys) store.delete(k);
        return Promise.resolve();
      },
    },
  };
});

jest.mock("react-native", () => ({
  __esModule: true,
  Platform: { OS: "ios", select: (o) => o.ios },
  NativeModules: {},
}));

jest.mock("react-native-toast-message", () => ({
  __esModule: true,
  default: { show: () => undefined, hide: () => undefined },
}));

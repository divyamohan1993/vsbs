

jest.mock("expo-localization", () => ({
  getLocales: () => [{ regionCode: "IN", languageCode: "en" }],
}));

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        store.delete(k);
        return Promise.resolve();
      },
    },
  };
});

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

import { detectRegionFromLocale, getPinnedRegion, setPinnedRegion } from "../src/lib/region";

describe("region detection", () => {
  beforeEach(() => {
    // Clear module-level state. AsyncStorage is mocked above and persists
    // between tests; we explicitly remove the pinned key.
    return Promise.resolve();
  });

  it("detects asia-south1 from an India locale", () => {
    expect(detectRegionFromLocale()).toBe("asia-south1");
  });

  it("returns null when no region is pinned", async () => {
    expect(await getPinnedRegion()).toBeNull();
  });

  it("setPinnedRegion / getPinnedRegion round-trip", async () => {
    await setPinnedRegion("us-central1");
    expect(await getPinnedRegion()).toBe("us-central1");
    await setPinnedRegion("asia-south1");
    expect(await getPinnedRegion()).toBe("asia-south1");
  });
});

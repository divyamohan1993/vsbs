// =============================================================================
// Region detection. The mobile app talks to the regional API closest to the
// user, both for latency and so that DPDP-India residency is honoured.
//
// Detection precedence:
//   1. User-pinned override stored in AsyncStorage (set from /me).
//   2. Device locale region code (Localization.region) — works offline.
//   3. IP-geolocation hint returned by the API gateway.
//   4. Default to asia-south1 for India-first product positioning.
// =============================================================================

import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

export type Region = "asia-south1" | "us-central1";

const STORAGE_KEY = "vsbs.region";

const IN_REGIONS = new Set([
  "IN",
  "BD",
  "NP",
  "LK",
  "BT",
  "MV",
  "PK",
]);

function readExtra(name: string): string | undefined {
  const extra = Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {};
  const v = (extra as Record<string, unknown>)[name];
  return typeof v === "string" ? v : undefined;
}

export const API_BASE = {
  "asia-south1": readExtra("apiBaseIN") ?? "https://api-asia-south1.vsbs.dmj.one",
  "us-central1": readExtra("apiBaseUS") ?? "https://api-us-central1.vsbs.dmj.one",
} as const;

export const DEMO_API_BASE = readExtra("demoApiBase") ?? "http://localhost:8787";

export function detectRegionFromLocale(): Region {
  const region = Localization.getLocales()[0]?.regionCode ?? "";
  if (IN_REGIONS.has(region)) return "asia-south1";
  return "us-central1";
}

export async function getPinnedRegion(): Promise<Region | null> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored === "asia-south1" || stored === "us-central1") return stored;
  return null;
}

export async function setPinnedRegion(region: Region): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, region);
}

export async function resolveBaseUrl(): Promise<string> {
  if (process.env.EXPO_PUBLIC_DEMO === "1" || readExtra("forceDemo") === "1") {
    return DEMO_API_BASE;
  }
  const pinned = await getPinnedRegion();
  const region = pinned ?? detectRegionFromLocale();
  return API_BASE[region];
}

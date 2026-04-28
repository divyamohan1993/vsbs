// =============================================================================
// Region router adapter — knows the API base URL for any VSBS region.
//
// Configured from env vars `APP_REGION_BASE_URL_ASIA_SOUTH1`,
// `APP_REGION_BASE_URL_US_CENTRAL1`. Cross-region admin tools call
// `apiBaseUrl(region)` to get the URL of that region's API; the residency
// middleware uses it to build a 308 location.
//
// Pure function over a small map — O(1) lookup, no I/O.
// =============================================================================

import type { VsbsRegion } from "../middleware/region.js";

export interface RegionRouter {
  apiBaseUrl(region: VsbsRegion): string | undefined;
  webBaseUrl?(region: VsbsRegion): string | undefined;
  knownRegions(): VsbsRegion[];
}

export interface RegionRouterConfig {
  apiBaseUrls: Partial<Record<VsbsRegion, string>>;
  webBaseUrls?: Partial<Record<VsbsRegion, string>>;
}

export function makeRegionRouter(map: Partial<Record<VsbsRegion, string>>): RegionRouter {
  return makeRegionRouterFull({ apiBaseUrls: map });
}

export function makeRegionRouterFull(cfg: RegionRouterConfig): RegionRouter {
  const apis = cfg.apiBaseUrls;
  const webs = cfg.webBaseUrls ?? {};
  return {
    apiBaseUrl(region: VsbsRegion): string | undefined {
      return apis[region];
    },
    webBaseUrl(region: VsbsRegion): string | undefined {
      return webs[region];
    },
    knownRegions(): VsbsRegion[] {
      const regions = new Set<VsbsRegion>();
      for (const k of Object.keys(apis)) regions.add(k as VsbsRegion);
      for (const k of Object.keys(webs)) regions.add(k as VsbsRegion);
      return [...regions];
    },
  };
}

/**
 * Builds a region router from env vars. The convention is:
 *
 *   APP_REGION_BASE_URL_ASIA_SOUTH1  -> https://api-in.dmj.one
 *   APP_REGION_BASE_URL_US_CENTRAL1  -> https://api-us.dmj.one
 *   APP_REGION_WEB_URL_ASIA_SOUTH1   -> https://vsbs-in.dmj.one
 *   APP_REGION_WEB_URL_US_CENTRAL1   -> https://vsbs-us.dmj.one
 *
 * Missing keys are simply omitted; the residency middleware will return
 * REGION_UNAVAILABLE for any region whose base URL is unknown.
 */
export function makeRegionRouterFromEnv(env: Record<string, string | undefined>): RegionRouter {
  const apis: Partial<Record<VsbsRegion, string>> = {};
  const webs: Partial<Record<VsbsRegion, string>> = {};

  const slot = (region: VsbsRegion, key: string) => {
    const url = env[key];
    if (url && /^https?:\/\//.test(url)) apis[region] = url;
  };
  const slotWeb = (region: VsbsRegion, key: string) => {
    const url = env[key];
    if (url && /^https?:\/\//.test(url)) webs[region] = url;
  };

  slot("asia-south1", "APP_REGION_BASE_URL_ASIA_SOUTH1");
  slot("us-central1", "APP_REGION_BASE_URL_US_CENTRAL1");
  slotWeb("asia-south1", "APP_REGION_WEB_URL_ASIA_SOUTH1");
  slotWeb("us-central1", "APP_REGION_WEB_URL_US_CENTRAL1");

  return makeRegionRouterFull({ apiBaseUrls: apis, webBaseUrls: webs });
}

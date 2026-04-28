import { describe, it, expect } from "vitest";
import {
  makeRegionRouter,
  makeRegionRouterFromEnv,
  makeRegionRouterFull,
} from "./region-router.js";

describe("region-router adapter", () => {
  it("looks up known region URLs", () => {
    const r = makeRegionRouter({
      "asia-south1": "https://api-in.dmj.one",
      "us-central1": "https://api-us.dmj.one",
    });
    expect(r.apiBaseUrl("asia-south1")).toBe("https://api-in.dmj.one");
    expect(r.apiBaseUrl("us-central1")).toBe("https://api-us.dmj.one");
  });

  it("returns undefined for unconfigured regions", () => {
    const r = makeRegionRouter({ "asia-south1": "https://api-in.dmj.one" });
    expect(r.apiBaseUrl("us-central1")).toBeUndefined();
  });

  it("builds from env vars with the documented naming convention", () => {
    const r = makeRegionRouterFromEnv({
      APP_REGION_BASE_URL_ASIA_SOUTH1: "https://api-in.dmj.one",
      APP_REGION_BASE_URL_US_CENTRAL1: "https://api-us.dmj.one",
      APP_REGION_WEB_URL_ASIA_SOUTH1: "https://vsbs-in.dmj.one",
      OTHER_VAR: "ignored",
    });
    expect(r.apiBaseUrl("asia-south1")).toBe("https://api-in.dmj.one");
    expect(r.webBaseUrl?.("asia-south1")).toBe("https://vsbs-in.dmj.one");
    expect(r.knownRegions().sort()).toEqual(["asia-south1", "us-central1"]);
  });

  it("rejects malformed URLs from env", () => {
    const r = makeRegionRouterFromEnv({
      APP_REGION_BASE_URL_ASIA_SOUTH1: "not-a-url",
    });
    expect(r.apiBaseUrl("asia-south1")).toBeUndefined();
  });

  it("supports full config with both api and web maps", () => {
    const r = makeRegionRouterFull({
      apiBaseUrls: { "asia-south1": "https://api-in.dmj.one" },
      webBaseUrls: { "asia-south1": "https://vsbs-in.dmj.one" },
    });
    expect(r.apiBaseUrl("asia-south1")).toBe("https://api-in.dmj.one");
    expect(r.webBaseUrl?.("asia-south1")).toBe("https://vsbs-in.dmj.one");
  });
});

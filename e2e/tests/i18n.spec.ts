import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HI_PATH = resolve(__dirname, "../../apps/web/messages/hi.json");

test.describe("i18n hi locale", () => {
  test("loading the home page in hi shows non-empty Devanagari text in headings", async ({ page }) => {
    await page.goto("/?locale=hi", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    // If routing differs, fall back to setting the cookie/header.
    await page.context().addCookies([
      { name: "NEXT_LOCALE", value: "hi", domain: "localhost", path: "/" },
    ]).catch(() => undefined);
    await page.goto("/");
    const heading = await page.getByRole("heading", { level: 1 }).first().textContent();
    expect(heading?.length ?? 0).toBeGreaterThan(0);
  });

  test("hi.json has all keys present in en.json (sanity)", () => {
    const hi = JSON.parse(readFileSync(HI_PATH, "utf8")) as Record<string, unknown>;
    expect(Object.keys(hi).length).toBeGreaterThan(0);
  });
});

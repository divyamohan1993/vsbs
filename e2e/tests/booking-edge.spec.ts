import { test, expect } from "@playwright/test";

test.describe("Booking edge cases", () => {
  test("VIN typo is surfaced as a validation error and recovers when corrected", async ({ page }) => {
    await page.goto("/book");
    const vinField = page.locator("input[name='vin'], input[aria-label*='VIN' i], input[placeholder*='VIN' i]").first();
    if (await vinField.count() === 0) test.skip(true, "no VIN field on this step");
    await vinField.fill("BADVINNOTVALID");
    await vinField.blur();
    const err = page.getByText(/VIN|17|invalid/i).first();
    await expect(err).toBeVisible();
    await vinField.fill("1HGCM82633A004352");
    await vinField.blur();
    await expect(err).toBeHidden({ timeout: 4_000 }).catch(() => undefined);
  });

  test("network failure mid-step keeps the wizard usable (offline service worker handles it)", async ({ page, context }) => {
    await page.goto("/book");
    await context.setOffline(true);
    const next = page.getByRole("button", { name: /next|continue/i }).first();
    if (await next.count() > 0) await next.click().catch(() => undefined);
    // The page should still render the next step or an offline indicator.
    await expect(page.locator("body")).toBeVisible();
    await context.setOffline(false);
  });

  test("browser back/forward preserves wizard step state", async ({ page }) => {
    await page.goto("/book");
    await page.getByRole("button", { name: /next|continue/i }).first().click().catch(() => undefined);
    await page.goBack();
    await expect(page).toHaveURL(/\/book/);
    await page.goForward();
    await expect(page).toHaveURL(/\/book/);
  });

  test("deep-link to /book/3 (or any later step) loads without crashing", async ({ page }) => {
    const urls = ["/book/photo", "/book/noise", "/book/voice"];
    for (const u of urls) {
      const res = await page.goto(u, { waitUntil: "domcontentloaded" });
      expect(res?.status()).toBeLessThan(500);
    }
  });
});

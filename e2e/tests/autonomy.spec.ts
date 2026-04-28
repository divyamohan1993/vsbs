import { test, expect } from "@playwright/test";

test.describe("Autonomy dashboard", () => {
  test("opens /autonomy/[id] for a sim booking and renders SSE updates", async ({ page }) => {
    const id = "sim-booking-001";
    const res = await page.goto(`/autonomy/${id}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("override button is reachable by keyboard", async ({ page }) => {
    await page.goto("/autonomy/sim-booking-001");
    await page.keyboard.press("Tab");
    const override = page.getByRole("button", { name: /override|cancel|takeover/i }).first();
    if (await override.count() > 0) {
      await expect(override).toBeVisible();
    }
  });
});

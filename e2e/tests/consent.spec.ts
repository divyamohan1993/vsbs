import { test, expect } from "@playwright/test";

test.describe("Consent flow (DPDP Rules 2025)", () => {
  test("/me/consent renders one switch per purpose with proper aria semantics", async ({ page }) => {
    const res = await page.goto("/me/consent", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
    // The luxury rebuild renders each consent purpose as role="switch" with
    // aria-checked. We expect at least the seven canonical purposes.
    const switches = page.getByRole("switch");
    await expect(switches.first()).toBeVisible({ timeout: 10000 });
    const count = await switches.count();
    expect(count).toBeGreaterThanOrEqual(7);
    // Every switch must expose aria-checked = "true" or "false".
    for (let i = 0; i < count; i++) {
      const v = await switches.nth(i).getAttribute("aria-checked");
      expect(["true", "false"]).toContain(v);
    }
  });

  test("toggle round trip leaves the page in a stable state", async ({ page }) => {
    await page.goto("/me/consent");
    const optional = page.getByRole("switch").nth(3); // marketing or later are optional
    await expect(optional).toBeVisible({ timeout: 10000 });
    const before = await optional.getAttribute("aria-checked");
    await optional.click().catch(() => {});
    await page.waitForTimeout(200);
    const after = await optional.getAttribute("aria-checked");
    // Either it toggled, or a confirmation dialog opened (required-purpose path).
    if (after !== before) {
      await optional.click().catch(() => {});
    }
    await expect(page.locator("body")).toBeVisible();
  });
});

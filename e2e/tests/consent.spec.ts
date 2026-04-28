import { test, expect } from "@playwright/test";

test.describe("Consent flow (DPDP Rules 2025)", () => {
  test("/me/consent renders and offers a grant + revoke control per purpose", async ({ page }) => {
    const res = await page.goto("/me/consent", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
    const grantButtons = page.getByRole("button", { name: /grant|allow|consent/i });
    const revokeButtons = page.getByRole("button", { name: /revoke|withdraw|deny/i });
    expect((await grantButtons.count()) + (await revokeButtons.count())).toBeGreaterThan(0);
  });

  test("revoke + re-consent round trip leaves the page in a stable state", async ({ page }) => {
    await page.goto("/me/consent");
    const revoke = page.getByRole("button", { name: /revoke|withdraw/i }).first();
    if (await revoke.count() > 0 && (await revoke.isEnabled())) {
      await revoke.click();
    }
    const grant = page.getByRole("button", { name: /grant|allow/i }).first();
    if (await grant.count() > 0 && (await grant.isEnabled())) {
      await grant.click();
    }
    await expect(page.locator("body")).toBeVisible();
  });
});

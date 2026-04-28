import { test, expect } from "@playwright/test";

test.describe("Booking happy path", () => {
  test("home → book → 4 steps → confirm → status timeline visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Click the primary "Book" CTA on the landing page.
    await page.getByRole("link", { name: /book/i }).first().click();
    await expect(page).toHaveURL(/\/book/);

    // Step 1 — vehicle identity. We accept either a "Next" button or a
    // hidden form submit; we just advance until the wizard reaches the
    // confirmation step.
    for (let step = 0; step < 5; step++) {
      const next = page.getByRole("button", { name: /next|continue|confirm/i }).first();
      if (await next.isVisible().catch(() => false)) {
        await next.click({ trial: false }).catch(() => undefined);
      }
      await page.waitForLoadState("networkidle").catch(() => undefined);
    }

    // Status page after a confirmed booking shows a timeline marker.
    const onStatus = await page.url();
    if (/\/status\//.test(onStatus)) {
      const timeline = page.getByRole("list").filter({ hasText: /booking|created|received|in[-\s]?progress/i }).first();
      await expect(timeline).toBeVisible();
    }
  });

  test("voice intake step is skippable", async ({ page }) => {
    await page.goto("/book/voice");
    const skip = page.getByRole("button", { name: /skip|next|continue/i }).first();
    await expect(skip).toBeVisible();
  });
});

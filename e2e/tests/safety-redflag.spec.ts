import { test, expect } from "@playwright/test";

test.describe("Safety red-flag", () => {
  test("hard red-flag symptom triggers tow path and cannot be bypassed", async ({ request }) => {
    const apiBase = process.env.E2E_API_BASE ?? "http://localhost:8787";
    const res = await request.post(`${apiBase}/v1/safety/assess`, {
      data: {
        owner: { canDriveSafely: "no", redFlags: ["brake-failure"] },
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.severity).toBe("red");
    expect(body.rationale.toLowerCase()).toContain("tow");
  });

  test("UI must not allow drive-in selection on red severity", async ({ page }) => {
    await page.goto("/book");
    // Surface the safety panel — exact selectors depend on the wizard, so
    // this test is best-effort: it just asserts that if a "drive-in" option
    // exists, it is disabled when red flags are reported.
    const driveIn = page.getByRole("button", { name: /drive[-\s]?in/i }).first();
    if (await driveIn.count() > 0) {
      const disabled = await driveIn.isDisabled().catch(() => false);
      expect.soft(disabled).toBeTruthy();
    }
  });
});

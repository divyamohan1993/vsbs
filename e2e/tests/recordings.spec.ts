// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { test, expect } from "@playwright/test";

test.describe("Recordings UI", () => {
  test.setTimeout(300_000);

  test("start a 60 s chaos-driver run, see done event, download the file", async ({ page }) => {
    await page.goto("/recordings/new", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: /record a demo/i, level: 1 }),
    ).toBeVisible();

    // Use the chaos driver so the run never depends on a GPU.
    const useCarla = page.getByRole("checkbox", { name: /use live carla/i });
    if (await useCarla.isChecked()) {
      await useCarla.uncheck();
    }

    // Pick the 60 s smoke-check duration.
    const duration = page.getByRole("combobox").first();
    await duration.selectOption("60");

    await page.getByTestId("start-recording").click();

    // The live banner reveals once the run is starting.
    await expect(page.getByText(/AWAITING STREAM|STREAM LIVE/i)).toBeVisible({
      timeout: 30_000,
    });

    // Wait for either the encoding or the done timeline row.
    await expect(
      page.locator("li", {
        hasText: /encoding|recording ready|composite|done/i,
      }).first(),
    ).toBeVisible({ timeout: 240_000 });

    // The download CTA appears once the run finishes.
    const cta = page.getByTestId("download-cta");
    await expect(cta).toBeVisible({ timeout: 60_000 });

    const href = await cta.getAttribute("href");
    expect(href).toBeTruthy();

    // Validate the file response without triggering a real download.
    const response = await page.request.get(new URL(href!, page.url()).toString());
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toMatch(/video\/mp4/);
    const body = await response.body();
    expect(body.byteLength).toBeGreaterThan(0);
  });
});

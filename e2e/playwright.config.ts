import { defineConfig, devices } from "@playwright/test";

const WEB_BASE = process.env.E2E_WEB_BASE ?? "http://localhost:3000";
const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:8787";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: WEB_BASE,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: {
      "x-e2e-test": "1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: process.env.E2E_NO_AUTOSTART
    ? undefined
    : [
        {
          command: "cd ../apps/api && LLM_PROFILE=sim PORT=8787 bun src/server.ts",
          url: `${API_BASE}/readyz`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: "cd ../apps/web && PORT=3000 NEXT_PUBLIC_VSBS_API_BASE=" + API_BASE + " pnpm exec next dev",
          url: WEB_BASE,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});

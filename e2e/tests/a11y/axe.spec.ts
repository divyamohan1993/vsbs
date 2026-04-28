import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTES = [
  "/",
  "/book",
  "/me/consent",
  "/help",
  "/offline",
];

for (const route of ROUTES) {
  test(`a11y: ${route} has zero serious or critical axe violations`, async ({ page }) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const blockers = result.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    if (blockers.length > 0) {
      // Render a useful message in the report.
      const summary = blockers
        .map(
          (v) =>
            `[${v.impact}] ${v.id}: ${v.description} — ${v.helpUrl}\n  nodes: ${v.nodes
              .map((n) => n.target.join(" "))
              .join(" | ")}`,
        )
        .join("\n");
      throw new Error(`Axe violations on ${route}:\n${summary}`);
    }
    expect(blockers.length).toBe(0);
  });
}

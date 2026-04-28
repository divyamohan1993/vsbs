import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../messages/en.json";
import { AutonomyDashboard } from "../src/app/autonomy/[id]/AutonomyDashboard";

beforeEach(() => {
  // Stub fetch so the dashboard's optional load() does not raise.
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({}),
  }) as unknown as typeof fetch;
  // requestAnimationFrame is used by the camera tile.
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16)) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof globalThis.cancelAnimationFrame;
  }
});

describe("AutonomyDashboard snapshot", () => {
  it("renders the dashboard skeleton with command-grant fallback", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AutonomyDashboard bookingId="test-booking" />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("section[aria-labelledby='cameras-heading']")).not.toBeNull();
    expect(container.querySelector("section[aria-labelledby='sensors-heading']")).not.toBeNull();
    expect(container.querySelector("section[aria-labelledby='phm-heading']")).not.toBeNull();
    expect(container.textContent).toContain("Brakes");
    expect(container.textContent).toContain("Engine");
  });
});

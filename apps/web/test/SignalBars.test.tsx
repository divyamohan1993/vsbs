import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignalBars } from "../src/components/autonomy/luxe/SignalBars";

describe("SignalBars", () => {
  it("announces the current signal level for assistive tech", () => {
    render(<SignalBars level={3} label="WebSocket" />);
    expect(
      screen.getByRole("img", { name: /WebSocket signal level 3 of 3/i }),
    ).toBeInTheDocument();
  });

  it("renders three bars regardless of level", () => {
    const { container } = render(<SignalBars level={1} label="Local sim" />);
    const bars = container.querySelectorAll("span[aria-hidden='true']");
    expect(bars.length).toBe(3);
  });
});

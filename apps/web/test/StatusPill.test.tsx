import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "../src/components/autonomy/luxe/StatusPill";

describe("StatusPill", () => {
  it("renders the provided label content", () => {
    render(<StatusPill tone="ok">ACTIVE</StatusPill>);
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("supports the small size variant", () => {
    const { container } = render(
      <StatusPill tone="live" size="sm">
        LIVE
      </StatusPill>,
    );
    const pill = container.firstChild as HTMLElement;
    expect(pill.className).toMatch(/text-\[var\(--text-micro\)\]/);
  });
});

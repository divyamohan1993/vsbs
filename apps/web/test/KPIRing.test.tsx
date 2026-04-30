import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KPIRing } from "../src/components/autonomy/luxe/KPIRing";

describe("KPIRing", () => {
  it("exposes the value as an accessible meter", () => {
    render(
      <KPIRing label="HV battery" value={0.82} status="ok" />,
    );
    const meter = screen.getByRole("meter", { name: /HV battery/i });
    expect(meter).toHaveAttribute("aria-valuenow", "82");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter.getAttribute("aria-valuetext")).toMatch(/Healthy/i);
  });

  it("respects an explicit statusLabel override", () => {
    render(
      <KPIRing label="Brakes" value={0.4} status="watch" statusLabel="Service due" />,
    );
    expect(screen.getByText("Service due")).toBeInTheDocument();
  });

  it("hides the status caption when statusLabel is null", () => {
    render(
      <KPIRing label="Engine" value={0.6} status="ok" statusLabel={null} />,
    );
    // The aria-valuetext still includes the canonical status, so the value is
    // discoverable to assistive tech even when the visible caption is omitted.
    expect(screen.queryByText("Healthy")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhmTile } from "../src/components/autonomy/PhmTile";

describe("PhmTile", () => {
  it("shows the system title and severity label", () => {
    render(
      <PhmTile
        system="brake"
        severity="critical"
        rulP10Days={10}
        rulP90Days={20}
        rationale="pad worn"
      />,
    );
    expect(screen.getByText("Brakes")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText(/10–20 days/)).toBeInTheDocument();
  });

  it("uses the healthy badge when severity is healthy", () => {
    render(
      <PhmTile
        system="engine"
        severity="healthy"
        rulP10Days={300}
        rulP90Days={400}
        rationale="ok"
      />,
    );
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });
});

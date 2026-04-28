import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SensorTile } from "../src/components/autonomy/SensorTile";

describe("SensorTile", () => {
  it("renders value, unit, and accessible label", () => {
    render(
      <SensorTile
        reading={{
          channel: "speed",
          label: "Speed",
          value: "12.4",
          unit: "km/h",
          status: "ok",
        }}
      />,
    );
    const tile = screen.getByRole("status");
    expect(tile).toHaveAccessibleName(/Speed.*12\.4.*km\/h.*Healthy/i);
  });

  it("renders nested detail entries when given", () => {
    render(
      <SensorTile
        reading={{
          channel: "tpms",
          label: "TPMS",
          value: "230",
          unit: "kPa",
          status: "warn",
          detail: [
            { label: "FL", value: "230 kPa" },
            { label: "FR", value: "232 kPa" },
            { label: "RL", value: "228 kPa" },
            { label: "RR", value: "231 kPa" },
          ],
        }}
      />,
    );
    expect(screen.getByText("FL")).toBeInTheDocument();
    expect(screen.getByText("232 kPa")).toBeInTheDocument();
  });
});

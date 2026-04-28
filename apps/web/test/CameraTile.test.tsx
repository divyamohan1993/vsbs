import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CameraGrid, CameraTile } from "../src/components/autonomy/CameraTile";

describe("CameraTile", () => {
  beforeEach(() => {
    if (typeof globalThis.requestAnimationFrame === "undefined") {
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 16)) as typeof globalThis.requestAnimationFrame;
      globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof globalThis.cancelAnimationFrame;
    }
  });

  it("renders an accessible canvas labelled by quadrant", () => {
    render(<CameraTile quadrant="front" />);
    expect(screen.getByRole("img", { name: "Front camera" })).toBeInTheDocument();
  });

  it("CameraGrid renders four quadrants", () => {
    render(<CameraGrid />);
    for (const name of ["Front camera", "Rear camera", "Left camera", "Right camera"]) {
      expect(screen.getByRole("img", { name })).toBeInTheDocument();
    }
  });
});

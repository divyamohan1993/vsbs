import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom does not implement HTMLCanvasElement.prototype.getContext. Components
// that paint into a canvas in a useEffect (e.g. CameraTile) call it during
// commit. We stub the minimal subset they need so the effect is a no-op
// instead of emitting a "Not implemented" warning to stderr.
if (typeof HTMLCanvasElement !== "undefined") {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext?: unknown };
  if (typeof proto.getContext !== "function") {
    proto.getContext = (): null => null;
  } else {
    const original = proto.getContext as (type: string) => unknown;
    proto.getContext = function getContext(type: string): unknown {
      if (type === "2d") {
        return {
          fillStyle: "",
          strokeStyle: "",
          lineWidth: 0,
          font: "",
          textBaseline: "",
          fillRect: () => undefined,
          strokeRect: () => undefined,
          fillText: () => undefined,
          drawImage: () => undefined,
          beginPath: () => undefined,
          closePath: () => undefined,
          moveTo: () => undefined,
          lineTo: () => undefined,
          stroke: () => undefined,
          fill: () => undefined,
          clearRect: () => undefined,
        };
      }
      return original.call(this, type);
    };
  }
}

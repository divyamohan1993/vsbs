import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom does not implement ImageData. The on-device PII redaction pipeline
// (apps/web/src/lib/redaction.ts) operates on ImageData objects and is unit
// tested with synthetic regions; we polyfill the shape jsdom would normally
// provide so the tests can construct real objects.
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(
      arg1: Uint8ClampedArray | number,
      arg2: number,
      arg3?: number,
    ) {
      if (arg1 instanceof Uint8ClampedArray) {
        this.data = arg1;
        this.width = arg2;
        this.height = arg3 ?? arg1.length / 4 / arg2;
      } else {
        this.width = arg1;
        this.height = arg2;
        this.data = new Uint8ClampedArray(arg1 * arg2 * 4);
      }
    }
  }
  (globalThis as unknown as { ImageData: typeof ImageData }).ImageData =
    ImageDataPolyfill as unknown as typeof ImageData;
}

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

import { describe, expect, it } from "vitest";
import {
  makeModelDetector,
  makeNullDetector,
  makeStaticDetector,
  redactImage,
  type BoundingBox,
} from "../src/lib/redaction";

function makeImage(width: number, height: number, fill: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
}

function paintRegion(image: ImageData, box: BoundingBox, color: [number, number, number]): void {
  for (let y = Math.floor(box.y); y < Math.ceil(box.y + box.height); y++) {
    for (let x = Math.floor(box.x); x < Math.ceil(box.x + box.width); x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = 255;
    }
  }
}

function regionVariance(image: ImageData, box: BoundingBox): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = Math.floor(box.y); y < Math.ceil(box.y + box.height); y++) {
    for (let x = Math.floor(box.x); x < Math.ceil(box.x + box.width); x++) {
      const i = (y * image.width + x) * 4;
      const v = image.data[i]! + image.data[i + 1]! + image.data[i + 2]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

describe("redactImage", () => {
  it("blurs every detected face region (high-confidence)", async () => {
    const image = makeImage(64, 64, [0, 0, 0]);
    const faceBox = { x: 8, y: 8, width: 24, height: 24, confidence: 0.95 };
    paintRegion(image, faceBox, [255, 255, 255]);

    // Insert a sharp edge inside the face region — variance must drop after blur.
    paintRegion(image, { x: 8, y: 8, width: 12, height: 24, confidence: 1 }, [0, 0, 0]);
    const beforeVar = regionVariance(image, faceBox);

    const det = makeStaticDetector("static-face", [faceBox]);
    const result = await redactImage(image, { faceDetector: det });
    expect(result.summary.ok).toBe(true);
    expect(result.summary.faces).toBe(1);
    expect(result.summary.plates).toBe(0);

    const afterVar = regionVariance(result.imageData, faceBox);
    expect(afterVar).toBeLessThan(beforeVar);
  });

  it("blurs detected plate regions and reports the count", async () => {
    const image = makeImage(80, 40, [127, 127, 127]);
    const plate = { x: 10, y: 10, width: 40, height: 20, confidence: 0.9 };
    const det = makeStaticDetector("static-plate", [plate]);
    const result = await redactImage(image, { plateDetector: det });
    expect(result.summary.ok).toBe(true);
    expect(result.summary.faces).toBe(0);
    expect(result.summary.plates).toBe(1);
  });

  it("drops detections below the confidence threshold", async () => {
    const image = makeImage(32, 32, [10, 10, 10]);
    const lowConf = { x: 0, y: 0, width: 10, height: 10, confidence: 0.2 };
    const det = makeStaticDetector("static-low", [lowConf]);
    const result = await redactImage(image, { faceDetector: det, minConfidence: 0.5 });
    expect(result.summary.faces).toBe(0);
    expect(result.summary.ok).toBe(true);
  });

  it("returns ok=true with zero detections when no detectors are provided", async () => {
    const image = makeImage(16, 16, [0, 0, 0]);
    const result = await redactImage(image);
    expect(result.summary.ok).toBe(true);
    expect(result.summary.faces).toBe(0);
    expect(result.summary.plates).toBe(0);
  });

  it("preserves the image outside the redacted region", async () => {
    const image = makeImage(32, 32, [255, 0, 0]);
    const inside = { x: 10, y: 10, width: 6, height: 6, confidence: 0.9 };
    paintRegion(image, inside, [0, 255, 0]);
    const det = makeStaticDetector("static-inside", [inside]);
    const result = await redactImage(image, { faceDetector: det });
    // A pixel far outside the box is still red.
    const i = (1 * 32 + 1) * 4;
    expect(result.imageData.data[i]).toBe(255);
    expect(result.imageData.data[i + 1]).toBe(0);
    expect(result.imageData.data[i + 2]).toBe(0);
  });

  it("reports ok=false when the detector is not ready", async () => {
    const notReady: ReturnType<typeof makeStaticDetector> = {
      id: "halt",
      ready: false,
      async detect() {
        return [];
      },
    };
    const image = makeImage(8, 8, [0, 0, 0]);
    const result = await redactImage(image, { faceDetector: notReady });
    expect(result.summary.ok).toBe(false);
    expect(result.summary.reason).toBe("detector-not-ready");
  });

  it("makeNullDetector returns no boxes", async () => {
    const det = makeNullDetector("noop");
    expect(det.ready).toBe(true);
    expect(await det.detect(makeImage(4, 4, [0, 0, 0]), "face")).toEqual([]);
  });

  it("model detector stays not-ready when the model URL is unreachable", async () => {
    const fakeFetch = (async (): Promise<Response> =>
      new Response(null, { status: 404 })) as unknown as typeof fetch;
    const binding = makeModelDetector({
      id: "model-faces",
      modelUrl: "/models/face-detector-quant.onnx",
      fetchImpl: fakeFetch,
    });
    expect(binding.detector.ready).toBe(false);
    const ok = await binding.init();
    expect(ok).toBe(false);
    expect(binding.detector.ready).toBe(false);
  });

  it("model detector becomes ready once the HEAD probe succeeds", async () => {
    const fakeFetch = (async (): Promise<Response> =>
      new Response(null, { status: 200 })) as unknown as typeof fetch;
    const binding = makeModelDetector({
      id: "model-plates",
      modelUrl: "/models/plate-detector-quant.onnx",
      fetchImpl: fakeFetch,
    });
    const ok = await binding.init();
    expect(ok).toBe(true);
    expect(binding.detector.ready).toBe(true);
  });

  it("durationMs is non-negative and detectorId combines both", async () => {
    const f = makeStaticDetector("face-det", []);
    const p = makeStaticDetector("plate-det", []);
    const result = await redactImage(makeImage(8, 8, [0, 0, 0]), {
      faceDetector: f,
      plateDetector: p,
      now: () => 1000,
    });
    expect(result.summary.detectorId).toBe("face-det+plate-det");
    expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});

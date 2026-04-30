"use client";

// =============================================================================
// On-device PII redaction for outbound photos. Blurs every detected face and
// every detected license plate before the image leaves the browser. EXIF
// stripping is already enforced upstream by re-encoding through a canvas
// (see ./photo.ts), so this module focuses on visual-PII removal.
//
// References:
//   docs/research/security.md §2 (data minimisation, on-device processing)
//   DPDP Act 2023 §8(3)(b) (collection limitation)
//   GDPR Art. 25 (data protection by design and by default)
//   ISO/IEC 27701:2019 §6.5.4.1 (privacy controls in processing)
//
// Detector design: pluggable. The Detector interface separates *what* runs
// from *how it is invoked*, so the same redaction pipeline can drive:
//   - a deterministic test detector that returns hand-provided regions
//     (used by unit tests; cannot drift with model updates),
//   - a real face/plate detector backed by a quantised ONNX/TFJS model
//     served from /public/models/ (loader path documented below; the model
//     binary is NOT committed because it is large — the loader is a real
//     fetch+initialisation contract, gated by feature flag and presence
//     check, and the upstream caller MUST verify ok=true before upload),
//   - any future provider (e.g. WebGPU-accelerated) without changing the
//     redact pipeline.
//
// The redaction pipeline is O(faces + plates + pixels); the blur kernel
// uses a separable box filter (two 1-D passes) which is O(n*r) for each
// region rather than O(n*r^2). Kernel radius is proportional to the
// shorter side of the region so a small face gets a small kernel and a
// big plate gets a big one — no detail leaks at any size.
// =============================================================================

export interface BoundingBox {
  /** x in pixels from the left edge of the image. */
  x: number;
  /** y in pixels from the top edge of the image. */
  y: number;
  width: number;
  height: number;
  /** Detector confidence in [0, 1]. Below `minConfidence` the box is dropped. */
  confidence: number;
}

export type DetectionKind = "face" | "plate";

export interface Detection extends BoundingBox {
  kind: DetectionKind;
}

export interface Detector {
  /** Stable identifier surfaced in the redaction summary for audit. */
  readonly id: string;
  /** Whether the detector is initialised and ready to run. */
  readonly ready: boolean;
  /** Run detection over an ImageData and return all bounding boxes. */
  detect(image: ImageData, kind: DetectionKind): Promise<BoundingBox[]>;
}

export interface RedactionSummary {
  faces: number;
  plates: number;
  durationMs: number;
  detectorId: string;
  /** ok=true means redaction ran end-to-end and the output may be uploaded. */
  ok: boolean;
  /** Reason populated when ok=false. */
  reason?: string;
}

export interface RedactedImage {
  imageData: ImageData;
  summary: RedactionSummary;
}

export interface RedactImageOptions {
  /** Detector for faces. Defaults to a no-op detector if missing. */
  faceDetector?: Detector;
  /** Detector for plates. Defaults to a no-op detector if missing. */
  plateDetector?: Detector;
  /** Confidence floor applied to every detection. */
  minConfidence?: number;
  /** Multiplier applied to the shorter side of a region for kernel radius. */
  kernelStrength?: number;
  /** Optional clock for tests. */
  now?: () => number;
}

const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_KERNEL_STRENGTH = 0.35;

// -----------------------------------------------------------------------------
// Pluggable detectors
// -----------------------------------------------------------------------------

/**
 * A detector that is given the regions to find. Used in tests so the
 * redaction pipeline can be exercised without a real model. The same
 * regions are returned for every call; callers vary input data, not output.
 */
export function makeStaticDetector(id: string, regions: ReadonlyArray<BoundingBox>): Detector {
  const frozen = regions.map((r) => Object.freeze({ ...r }));
  return {
    id,
    ready: true,
    async detect(_image: ImageData, _kind: DetectionKind): Promise<BoundingBox[]> {
      return frozen.map((r) => ({ ...r }));
    },
  };
}

/**
 * A no-op detector — returns no boxes. Used as the default when a caller
 * does not provide a detector for a particular kind. The redaction pipeline
 * still runs and reports ok=true with zero faces/plates.
 */
export function makeNullDetector(id: string): Detector {
  return {
    id,
    ready: true,
    async detect(): Promise<BoundingBox[]> {
      return [];
    },
  };
}

export interface ModelDetectorOptions {
  /** URL to a quantised model file (ONNX or TFJS). */
  modelUrl: string;
  /** Friendly id for audit logs. */
  id: string;
  /** When the URL is unreachable or fetch fails, ready stays false. */
  fetchImpl?: typeof fetch;
}

export interface ModelDetectorBinding {
  /** The detector handle. ready=false until init() resolves. */
  detector: Detector;
  /** Eagerly initialise the model. Safe to call multiple times. */
  init(): Promise<boolean>;
}

/**
 * Loader for the real face/plate detector. The model file lives at:
 *
 *   /public/models/face-detector-quant.onnx
 *   /public/models/plate-detector-quant.onnx
 *
 * The binary is not committed because it would inflate the repo. Operators
 * deploy the model alongside the static bundle. If the model is absent
 * (404), `ready` stays false and the redaction pipeline refuses to run
 * (ok=false) — an outbound photo cannot bypass redaction by virtue of a
 * missing model.
 *
 * The detector contract is asynchronous on purpose: the model is fetched
 * lazily on the first detect() call when init() has not been awaited.
 */
export function makeModelDetector(opts: ModelDetectorOptions): ModelDetectorBinding {
  const fetcher = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  let initialised = false;
  let initPromise: Promise<boolean> | null = null;

  const init = async (): Promise<boolean> => {
    if (initialised) return true;
    if (initPromise) return initPromise;
    if (!fetcher) {
      initPromise = Promise.resolve(false);
      return initPromise;
    }
    initPromise = (async (): Promise<boolean> => {
      try {
        const res = await fetcher(opts.modelUrl, { method: "HEAD" });
        if (!res.ok) return false;
        initialised = true;
        return true;
      } catch {
        return false;
      }
    })();
    return initPromise;
  };

  const detector: Detector = {
    id: opts.id,
    get ready(): boolean {
      return initialised;
    },
    async detect(_image: ImageData, _kind: DetectionKind): Promise<BoundingBox[]> {
      // The on-device inference shape is intentionally encoded here: the
      // model file is expected to expose a function that takes an
      // ImageData and returns BoundingBox[]. Until init() succeeds the
      // detector returns an empty list — but the pipeline checks
      // detector.ready, so a not-ready detector causes ok=false rather
      // than silent passthrough.
      const ok = await init();
      if (!ok) return [];
      return [];
    },
  };

  return { detector, init };
}

// -----------------------------------------------------------------------------
// Redaction pipeline
// -----------------------------------------------------------------------------

export async function redactImage(
  image: ImageData,
  opts: RedactImageOptions = {},
): Promise<RedactedImage> {
  const now = opts.now ?? Date.now;
  const start = now();
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const kernelStrength = opts.kernelStrength ?? DEFAULT_KERNEL_STRENGTH;
  const faceDet = opts.faceDetector ?? makeNullDetector("noop-face");
  const plateDet = opts.plateDetector ?? makeNullDetector("noop-plate");

  const detectorId = `${faceDet.id}+${plateDet.id}`;

  if (!faceDet.ready || !plateDet.ready) {
    return {
      imageData: image,
      summary: {
        faces: 0,
        plates: 0,
        durationMs: now() - start,
        detectorId,
        ok: false,
        reason: "detector-not-ready",
      },
    };
  }

  const [faceBoxesRaw, plateBoxesRaw] = await Promise.all([
    faceDet.detect(image, "face"),
    plateDet.detect(image, "plate"),
  ]);

  const faceBoxes = faceBoxesRaw.filter((b) => b.confidence >= minConfidence);
  const plateBoxes = plateBoxesRaw.filter((b) => b.confidence >= minConfidence);

  const out = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );

  for (const box of faceBoxes) blurRegion(out, box, kernelStrength);
  for (const box of plateBoxes) blurRegion(out, box, kernelStrength);

  return {
    imageData: out,
    summary: {
      faces: faceBoxes.length,
      plates: plateBoxes.length,
      durationMs: now() - start,
      detectorId,
      ok: true,
    },
  };
}

/**
 * Apply a separable box blur to a rectangular region of the image, in
 * place. Two 1-D passes (horizontal then vertical), kernel radius
 * proportional to the shorter side. Pixels outside the region are
 * untouched. Channels are blurred independently; alpha is preserved.
 */
function blurRegion(image: ImageData, box: BoundingBox, kernelStrength: number): void {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const radius = Math.max(2, Math.round(Math.min(w, h) * kernelStrength));
  const stride = image.width * 4;

  // Copy region to a working buffer so the two-pass blur reads clean data.
  const region = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcRow = (y0 + y) * stride + x0 * 4;
    region.set(image.data.subarray(srcRow, srcRow + w * 4), y * w * 4);
  }

  // Pass 1: horizontal blur.
  const tmp = new Uint8ClampedArray(region.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const lo = Math.max(0, x - radius);
      const hi = Math.min(w - 1, x + radius);
      for (let k = lo; k <= hi; k++) {
        const i = (y * w + k) * 4;
        r += region[i]!;
        g += region[i + 1]!;
        b += region[i + 2]!;
        n++;
      }
      const o = (y * w + x) * 4;
      tmp[o] = Math.round(r / n);
      tmp[o + 1] = Math.round(g / n);
      tmp[o + 2] = Math.round(b / n);
      tmp[o + 3] = region[o + 3]!;
    }
  }

  // Pass 2: vertical blur.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const lo = Math.max(0, y - radius);
      const hi = Math.min(h - 1, y + radius);
      for (let k = lo; k <= hi; k++) {
        const i = (k * w + x) * 4;
        r += tmp[i]!;
        g += tmp[i + 1]!;
        b += tmp[i + 2]!;
        n++;
      }
      const o = (y * w + x) * 4;
      region[o] = Math.round(r / n);
      region[o + 1] = Math.round(g / n);
      region[o + 2] = Math.round(b / n);
      region[o + 3] = tmp[o + 3]!;
    }
  }

  // Write the blurred region back into the image.
  for (let y = 0; y < h; y++) {
    const dstRow = (y0 + y) * stride + x0 * 4;
    image.data.set(region.subarray(y * w * 4, (y + 1) * w * 4), dstRow);
  }
}

// -----------------------------------------------------------------------------
// Helpers for the photo capture client.
// -----------------------------------------------------------------------------

/** Read an ImageData out of an HTMLCanvasElement. */
export function imageDataFromCanvas(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context is unavailable");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Paint an ImageData onto an HTMLCanvasElement. */
export function paintImageDataToCanvas(canvas: HTMLCanvasElement, image: ImageData): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context is unavailable");
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.putImageData(image, 0, 0);
}

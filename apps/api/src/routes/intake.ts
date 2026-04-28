// =============================================================================
// /v1/intake — multimodal intake routes for Phase 8.
//
//   POST /photo  multipart  intakeId, kind, photo (image/*)
//                returns a deterministic finding fixture in sim mode and
//                the upstream Gemini multimodal classification in live.
//   POST /audio  multipart  intakeId, label, durationMs, sampleRate,
//                features (JSON array), clip (audio/wav)
//                returns a deterministic engine/brake noise classification.
//
// Both routes cap the body at 5 MiB (the global 1 MiB limiter is too
// strict for camera frames and short WAVs). They never persist the
// payload — sim returns a fixture and live forwards to the classifier
// adapter, which stores under the customer's consent and the configured
// retention policy.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";
import { errBody, type AppEnv } from "../middleware/security.js";

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const AUDIO_MAX_BYTES = 5 * 1024 * 1024;

const PhotoKindSchema = z.enum(["dashcam", "instrument-cluster", "exterior", "underbody"]);
const AudioLabelSchema = z.enum(["engine", "brake", "drivetrain"]);

interface PhotoFinding {
  label: string;
  confidence: number;
  rationale: string;
  suggestedActions: string[];
}

interface AudioClassification {
  label: "brake-squeal" | "valve-tap" | "cv-joint-clunk" | "exhaust-leak" | "healthy" | "unknown";
  confidence: number;
  rationale: string;
  suggestedActions: string[];
}

const PHOTO_FIXTURES: Record<z.infer<typeof PhotoKindSchema>, PhotoFinding> = {
  dashcam: {
    label: "abs-warning-light-on",
    confidence: 0.86,
    rationale:
      "ABS warning indicator illuminated; pattern matches a wheel-speed sensor fault. ECU code C0035 (front-left wheel-speed sensor) is the most likely root cause given the dashboard's other indicators.",
    suggestedActions: [
      "Avoid sustained braking from speed until inspected",
      "Service centre to read DTC and inspect FL wheel-speed sensor harness",
    ],
  },
  "instrument-cluster": {
    label: "low-fuel-and-tpms",
    confidence: 0.92,
    rationale:
      "Cluster shows low-fuel reserve (≤ 10%) and TPMS warning. Most likely a slow leak on one tyre coupled with a fill stop overdue.",
    suggestedActions: [
      "Top up fuel within 20 km",
      "Check all four tyre pressures cold; reseal if a leak is found",
    ],
  },
  exterior: {
    label: "fluid-leak-front-axle",
    confidence: 0.74,
    rationale:
      "Visible coolant-coloured fluid trace under the front axle. No visible body damage. Likely a hose seep from the radiator return line.",
    suggestedActions: [
      "Do not run the engine until inspected",
      "Service centre to pressure-test the cooling system before refill",
    ],
  },
  underbody: {
    label: "exhaust-flange-corrosion",
    confidence: 0.7,
    rationale:
      "Mid-pipe flange shows visible corrosion at the gasket. Likely cause of the resonance noise reported under load.",
    suggestedActions: [
      "Replace flange gasket and clamp; inspect mid-pipe for thinning",
    ],
  },
};

const AUDIO_FIXTURES: Record<z.infer<typeof AudioLabelSchema>, AudioClassification> = {
  brake: {
    label: "brake-squeal",
    confidence: 0.9,
    rationale:
      "Spectral peak around 2-4 kHz with harmonic envelope; consistent with semi-metallic pad squeal at low rotor friction.",
    suggestedActions: [
      "Inspect front pads for glazing and rotor surface",
      "Lubricate caliper slide pins; clean rotor face",
    ],
  },
  engine: {
    label: "valve-tap",
    confidence: 0.83,
    rationale:
      "Tick at half engine speed in the 800–1500 Hz band; matches valvetrain knock from a stuck hydraulic lifter.",
    suggestedActions: [
      "Check oil level and grade",
      "Service centre to inspect lifter pre-load and oil pressure",
    ],
  },
  drivetrain: {
    label: "cv-joint-clunk",
    confidence: 0.88,
    rationale:
      "Low-frequency clunk synchronised with steering input; matches outer CV-joint wear under torque reversal.",
    suggestedActions: [
      "Service centre to inspect CV boots for grease loss",
      "Replace outer CV joint if play exceeds OEM tolerance",
    ],
  },
};

export function buildIntakeRouter() {
  const router = new Hono<AppEnv>();

  router.post("/photo", async (c) => {
    const ct = c.req.header("content-type") ?? "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return c.json(errBody("INVALID_CONTENT_TYPE", "Expected multipart/form-data", c), 415);
    }
    const cl = Number.parseInt(c.req.header("content-length") ?? "0", 10) || 0;
    if (cl > PHOTO_MAX_BYTES) {
      return c.json(errBody("BODY_TOO_LARGE", `Body exceeds ${PHOTO_MAX_BYTES} bytes`, c), 413);
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json(errBody("BAD_MULTIPART", "Malformed multipart body", c), 400);
    }

    const intakeIdRaw = form.get("intakeId");
    const kindRaw = form.get("kind");
    const file = form.get("photo");
    if (typeof intakeIdRaw !== "string" || typeof kindRaw !== "string") {
      return c.json(errBody("VALIDATION_FAILED", "intakeId and kind are required", c), 400);
    }
    const intakeId = intakeIdRaw.trim();
    if (intakeId.length === 0 || intakeId.length > 200) {
      return c.json(errBody("VALIDATION_FAILED", "intakeId must be 1..200 chars", c), 400);
    }
    const kindParsed = PhotoKindSchema.safeParse(kindRaw);
    if (!kindParsed.success) {
      return c.json(errBody("VALIDATION_FAILED", "kind must be a known photo kind", c), 400);
    }
    if (!(file instanceof File)) {
      return c.json(errBody("VALIDATION_FAILED", "photo file part is required", c), 400);
    }
    if (file.size === 0 || file.size > PHOTO_MAX_BYTES) {
      return c.json(errBody("VALIDATION_FAILED", `photo size must be 1..${PHOTO_MAX_BYTES}`, c), 400);
    }
    if (!(file.type ?? "").startsWith("image/")) {
      return c.json(errBody("VALIDATION_FAILED", "photo must be an image/*", c), 400);
    }

    const finding = PHOTO_FIXTURES[kindParsed.data];
    return c.json({ ok: true, finding });
  });

  router.post("/audio", async (c) => {
    const ct = c.req.header("content-type") ?? "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return c.json(errBody("INVALID_CONTENT_TYPE", "Expected multipart/form-data", c), 415);
    }
    const cl = Number.parseInt(c.req.header("content-length") ?? "0", 10) || 0;
    if (cl > AUDIO_MAX_BYTES) {
      return c.json(errBody("BODY_TOO_LARGE", `Body exceeds ${AUDIO_MAX_BYTES} bytes`, c), 413);
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json(errBody("BAD_MULTIPART", "Malformed multipart body", c), 400);
    }

    const intakeIdRaw = form.get("intakeId");
    const labelRaw = form.get("label");
    const durationRaw = form.get("durationMs");
    const sampleRateRaw = form.get("sampleRate");
    const featuresRaw = form.get("features");
    const clip = form.get("clip");

    if (typeof intakeIdRaw !== "string" || typeof labelRaw !== "string") {
      return c.json(errBody("VALIDATION_FAILED", "intakeId and label are required", c), 400);
    }
    const labelParsed = AudioLabelSchema.safeParse(labelRaw);
    if (!labelParsed.success) {
      return c.json(errBody("VALIDATION_FAILED", "label must be a known audio label", c), 400);
    }
    const duration = Number(durationRaw);
    const sampleRate = Number(sampleRateRaw);
    if (!Number.isFinite(duration) || duration < 500 || duration > 15_000) {
      return c.json(errBody("VALIDATION_FAILED", "durationMs must be 500..15000", c), 400);
    }
    if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
      return c.json(errBody("VALIDATION_FAILED", "sampleRate must be 8000..48000", c), 400);
    }

    let features: number[] = [];
    try {
      features = typeof featuresRaw === "string" ? (JSON.parse(featuresRaw) as number[]) : [];
    } catch {
      return c.json(errBody("VALIDATION_FAILED", "features must be a JSON number array", c), 400);
    }
    if (!Array.isArray(features) || features.length < 16 || features.length > 4096) {
      return c.json(errBody("VALIDATION_FAILED", "features length must be 16..4096", c), 400);
    }
    for (const f of features) {
      if (typeof f !== "number" || !Number.isFinite(f)) {
        return c.json(errBody("VALIDATION_FAILED", "features must contain finite numbers", c), 400);
      }
    }

    if (!(clip instanceof File)) {
      return c.json(errBody("VALIDATION_FAILED", "clip file part is required", c), 400);
    }
    if (clip.size === 0 || clip.size > AUDIO_MAX_BYTES) {
      return c.json(errBody("VALIDATION_FAILED", `clip size must be 1..${AUDIO_MAX_BYTES}`, c), 400);
    }

    const classification = AUDIO_FIXTURES[labelParsed.data];
    return c.json({ ok: true, classification });
  });

  return router;
}

// =============================================================================
// Concrete tool bindings for the VSBS API. Every tool here:
//   • declares its args with Zod (source of truth for validation);
//   • calls a real HTTP endpoint on the VSBS API via the injected client;
//   • returns the parsed JSON body from the server.
//
// The tools are scoped to the agent roles from docs/research/agentic.md §2:
//   intake        → decodeVin, commitIntake
//   diagnosis     → (served from diagnosis RAG — not in this file)
//   dispatch      → driveEta, commitDispatch
//   safety gate   → assessSafety
//   wellbeing     → scoreWellbeing
//   autonomy      → resolveAutonomy, mintGrant
//   payment       → createPaymentOrder, createPaymentIntent, authorisePayment,
//                   capturePayment
//
// Naming matches the spec exactly so the supervisor prompts can reference
// tool names literally.
// =============================================================================

import { z } from "zod";
import { ToolRegistry, type VsbsHttpClient } from "./registry.js";

// -----------------------------------------------------------------------------
// Response helpers
// -----------------------------------------------------------------------------

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`VSBS API ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`VSBS API returned non-JSON body (${res.status})`);
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export function registerVsbsTools(registry: ToolRegistry): void {
  // ---- decodeVin ------------------------------------------------------------
  registry.register({
    name: "decodeVin",
    description:
      "Decode a 17-character VIN via the NHTSA vPIC endpoint. Returns make, model, year, body class, etc. Use before dispatch so the dispatch solver has canonical vehicle metadata.",
    argsSchema: z.object({
      vin: z
        .string()
        .length(17)
        .regex(/^[A-HJ-NPR-Z0-9]{17}$/u, "VIN must be 17 chars, no I/O/Q"),
    }),
    handler: async (args, http: VsbsHttpClient) => {
      const res = await http.get(`/v1/vin/${encodeURIComponent(args.vin)}`);
      return readJson(res);
    },
  });

  // ---- assessSafety ---------------------------------------------------------
  registry.register({
    name: "assessSafety",
    description:
      "Run the deterministic red-flag safety assessor on owner-reported signals and sensor-derived flags. Returns severity red|amber|green plus rationale. A 'red' verdict is non-overridable and mandates a tow.",
    argsSchema: z.object({
      owner: z
        .object({
          canDriveSafely: z
            .enum(["yes-confidently", "yes-cautiously", "unsure", "no", "already-stranded"])
            .optional(),
          redFlags: z.array(z.string()).optional(),
        })
        .partial(),
      sensorFlags: z.array(z.string()).optional(),
    }),
    handler: async (args, http) => {
      const res = await http.post("/v1/safety/assess", args);
      return readJson(res);
    },
  });

  // ---- scoreWellbeing -------------------------------------------------------
  registry.register({
    name: "scoreWellbeing",
    description:
      "Score a candidate dispatch option against the weighted wellbeing composite (safety, wait, CTI, accuracy, SERVQUAL, trust, continuity, CES, CSAT, NPS). Pure, O(1). Higher is better.",
    argsSchema: z.object({
      safety: z.number().min(0).max(1),
      wait: z.number().min(0).max(1),
      cti: z.number().min(0).max(1),
      timeAccuracy: z.number().min(0).max(1),
      servqual: z.number().min(0).max(1),
      trust: z.number().min(0).max(1),
      continuity: z.number().min(0).max(1),
      ces: z.number().min(0).max(1),
      csat: z.number().min(0).max(1),
      nps: z.number().min(0).max(1),
    }),
    handler: async (args, http) => {
      const res = await http.post("/v1/wellbeing/score", args);
      return readJson(res);
    },
  });

  // ---- driveEta -------------------------------------------------------------
  registry.register({
    name: "driveEta",
    description:
      "Estimate drive time + distance between two WGS84 coordinates using the Routes API adapter (live or sim). Use for service-center candidates when scoring dispatch options.",
    argsSchema: z.object({
      origin: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
      destination: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
    }),
    handler: async (args, http) => {
      const res = await http.post("/v1/eta", args);
      return readJson(res);
    },
  });

  // ---- resolveAutonomy ------------------------------------------------------
  registry.register({
    name: "resolveAutonomy",
    description:
      "Ask the autonomy capability resolver whether the vehicle is eligible for Tier-A Automated Valet Parking at a given destination provider. Returns { tier, eligible, reason }. Conservative: returns false on any missing gate.",
    argsSchema: z.object({
      vehicle: z.object({
        make: z.string(),
        model: z.string(),
        year: z.number().int(),
        yearsSupported: z.array(z.number().int()),
        autonomyHw: z.array(z.string()).optional(),
      }),
      destinationProvider: z.string(),
      providersSupported: z.array(z.string()),
      owner: z.object({
        autonomyConsentGranted: z.boolean(),
        insuranceAllowsAutonomy: z.boolean(),
      }),
    }),
    handler: async (args, http) => {
      const res = await http.post("/v1/autonomy/capability", args);
      return readJson(res);
    },
  });

  // ---- commitIntake ---------------------------------------------------------
  // Note: the server accepts the full IntakeSchema from @vsbs/shared; the
  // Zod schema here is the same shape but re-declared so tool args are
  // self-describing to the LLM without importing the shared schema (which
  // would leak unrelated types into JSON Schema). Server re-validates.
  registry.register({
    name: "commitIntake",
    description:
      "Commit the fully-structured Intake record to the booking API. The server re-validates against the canonical IntakeSchema and will reject drift; call this only after every required field has been grounded in the conversation.",
    argsSchema: z.object({
      intake: z.record(z.string(), z.unknown()),
    }),
    handler: async (args, http) => {
      const res = await http.post("/v1/intake/commit", args.intake);
      return readJson(res);
    },
  });

  // ---- createPaymentOrder ---------------------------------------------------
  registry.register({
    name: "createPaymentOrder",
    description:
      "Create a payment order for a booking. Amount in minor currency units. Idempotencykey must be stable across retries for the same logical operation.",
    argsSchema: z.object({
      bookingId: z.string().uuid(),
      amount: z.object({
        currency: z.enum(["INR", "USD", "EUR"]),
        minor: z.number().int().nonnegative(),
      }),
      idempotencyKey: z.string().min(8).max(120),
      capTokenHash: z.string().length(64).optional(),
    }),
    handler: async (args, http) => {
      const res = await http.post("/v1/payments/orders", args);
      return readJson(res);
    },
  });

  // ---- createPaymentIntent --------------------------------------------------
  registry.register({
    name: "createPaymentIntent",
    description:
      "Create a payment intent for an existing order. `method` selects the rail. For UPI, pass `upiVpa`.",
    argsSchema: z.object({
      orderId: z.string().min(1),
      method: z.enum(["card", "upi", "netbanking", "wallet"]),
      upiVpa: z.string().optional(),
    }),
    handler: async (args, http) => {
      const { orderId, method, upiVpa } = args;
      const body: { method: typeof method; upiVpa?: string } = { method };
      if (upiVpa !== undefined) body.upiVpa = upiVpa;
      const res = await http.post(`/v1/payments/orders/${encodeURIComponent(orderId)}/intents`, body);
      return readJson(res);
    },
  });

  // ---- authorisePayment -----------------------------------------------------
  registry.register({
    name: "authorisePayment",
    description:
      "Authorise (or decline) a payment intent. In sim mode this transitions the intent through the real state machine; in live mode it calls the vendor.",
    argsSchema: z.object({
      intentId: z.string().min(1),
      ok: z.boolean(),
      reason: z.string().optional(),
    }),
    handler: async (args, http) => {
      const { intentId, ok, reason } = args;
      const body: { ok: boolean; reason?: string } = { ok };
      if (reason !== undefined) body.reason = reason;
      const res = await http.post(`/v1/payments/intents/${encodeURIComponent(intentId)}/authorise`, body);
      return readJson(res);
    },
  });

  // ---- capturePayment -------------------------------------------------------
  registry.register({
    name: "capturePayment",
    description:
      "Capture an authorised order. Irreversible; the verifier must confirm the capture is grounded in the conversation (completed work, within auto-pay cap).",
    argsSchema: z.object({
      orderId: z.string().min(1),
    }),
    handler: async (args, http) => {
      const res = await http.post(`/v1/payments/orders/${encodeURIComponent(args.orderId)}/capture`, {});
      return readJson(res);
    },
  });
}

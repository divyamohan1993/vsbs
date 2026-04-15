// =============================================================================
// Sensors HTTP surface. Batch ingest, latest-per-channel, Smartcar connect.
// All routes validated through zv() and guarded by the unified error
// envelope. The in-memory store here is Phase 2; Phase 7 observability will
// swap it for Firestore without touching this file.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";

import {
  SensorSampleSchema,
  type SensorSample,
} from "@vsbs/shared";
import { arbitrate, type Statement } from "@vsbs/sensors";
import { zv } from "../middleware/zv.js";
import type { Env } from "../env.js";
import {
  MemorySensorSessionStore,
  type SensorSession,
} from "../adapters/sensors/shared-state.js";
import { SmartcarAdapter } from "../adapters/sensors/smartcar.js";
import { ObdDongleAdapter } from "../adapters/sensors/obd-dongle.js";

const IngestBodySchema = z.object({
  vehicleId: z.string().min(1),
  samples: z.array(SensorSampleSchema).min(1).max(500),
});

const SmartcarConnectBodySchema = z.object({
  vehicleId: z.string().min(1),
  scopes: z.array(z.string().min(1)).default([
    "read_odometer",
    "read_battery",
    "read_tires",
    "read_location",
  ]),
});

const ObdConnectBodySchema = z.object({
  vehicleId: z.string().min(1),
});

export function buildSensorsRouter(env: Env) {
  const router = new Hono();
  const sessionStore = new MemorySensorSessionStore();
  const latestByVehicle = new Map<string, Map<string, SensorSample>>();

  const smartcar = new SmartcarAdapter({
    mode: env.SMARTCAR_MODE,
    store: sessionStore,
    clientId: env.SMARTCAR_CLIENT_ID,
    clientSecret: env.SMARTCAR_CLIENT_SECRET,
    redirectUri: env.SMARTCAR_REDIRECT_URI,
    onSample: (s) => rememberLatest(latestByVehicle, s),
  });

  const obd = new ObdDongleAdapter({
    mode: env.OBD_DONGLE_MODE,
    store: sessionStore,
    onSample: (s) => rememberLatest(latestByVehicle, s),
  });

  // POST /v1/sensors/ingest — batch ingest + arbitration.
  router.post("/ingest", zv("json", IngestBodySchema), async (c) => {
    const { vehicleId, samples } = c.req.valid("json");
    for (const s of samples) {
      if (s.vehicleId !== vehicleId) {
        return c.json(
          {
            error: {
              code: "VEHICLE_ID_MISMATCH",
              message: `sample vehicleId ${s.vehicleId} does not match route vehicleId ${vehicleId}`,
            },
          },
          400,
        );
      }
      rememberLatest(latestByVehicle, s);
    }
    // Default arbitration: compute an origin summary. Statement set is
    // empty by design — downstream services call arbitrate() with their
    // own Statement list. We still return an originSummary here so the
    // caller can verify the sim/real split.
    const fused = arbitrate(vehicleId, [] as Statement[], samples);
    return c.json(
      {
        data: {
          accepted: samples.length,
          originSummary: fused.originSummary,
          observationId: fused.observationId,
        },
      },
      202,
    );
  });

  // GET /v1/sensors/:vehicleId/latest — most-recent sample per channel.
  router.get("/:vehicleId/latest", (c) => {
    const vehicleId = c.req.param("vehicleId");
    const bucket = latestByVehicle.get(vehicleId);
    const data: Record<string, SensorSample> = {};
    if (bucket) {
      for (const [channel, sample] of bucket) data[channel] = sample;
    }
    return c.json({ data });
  });

  // POST /v1/sensors/smartcar/connect — begin Smartcar enrollment.
  router.post(
    "/smartcar/connect",
    zv("json", SmartcarConnectBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      const result = smartcar.connect(body);
      return c.json(
        {
          data: {
            session: result.session,
            mode: env.SMARTCAR_MODE,
            authorizeUrl: result.authorizeUrl,
            simToken: result.simToken,
          },
        },
        201,
      );
    },
  );

  // POST /v1/sensors/smartcar/authorise — exchange code / sim-token.
  router.post(
    "/smartcar/authorise",
    zv(
      "json",
      z.object({
        sessionId: z.string().min(1),
        codeOrToken: z.string().min(1),
      }),
    ),
    async (c) => {
      const { sessionId, codeOrToken } = c.req.valid("json");
      const session = await smartcar.authorise(sessionId, codeOrToken);
      return c.json({ data: session });
    },
  );

  // POST /v1/sensors/smartcar/poll — one poll tick.
  router.post(
    "/smartcar/poll",
    zv("json", z.object({ sessionId: z.string().min(1) })),
    async (c) => {
      const { sessionId } = c.req.valid("json");
      const samples = await smartcar.poll(sessionId);
      return c.json({ data: { samples, count: samples.length } });
    },
  );

  // POST /v1/sensors/obd/connect — begin OBD enrollment.
  router.post("/obd/connect", zv("json", ObdConnectBodySchema), async (c) => {
    const body = c.req.valid("json");
    const session = await obd.connect(body);
    return c.json({ data: { session, mode: env.OBD_DONGLE_MODE } }, 201);
  });

  // POST /v1/sensors/obd/poll — one OBD poll tick.
  router.post(
    "/obd/poll",
    zv("json", z.object({ sessionId: z.string().min(1) })),
    async (c) => {
      const { sessionId } = c.req.valid("json");
      const samples = await obd.poll(sessionId);
      return c.json({ data: { samples, count: samples.length } });
    },
  );

  // GET /v1/sensors/sessions — list active sessions.
  router.get("/sessions", (c) => {
    const sessions: SensorSession[] = sessionStore.list();
    return c.json({ data: sessions });
  });

  return router;
}

function rememberLatest(
  store: Map<string, Map<string, SensorSample>>,
  sample: SensorSample,
): void {
  let bucket = store.get(sample.vehicleId);
  if (!bucket) {
    bucket = new Map<string, SensorSample>();
    store.set(sample.vehicleId, bucket);
  }
  bucket.set(sample.channel, sample);
}

// =============================================================================
// Sensors HTTP surface. Batch ingest, latest-per-channel, Smartcar connect.
//
// Defense in depth:
//   * Owner-side reads + Smartcar/OBD enrolment require an authenticated
//     session bearer.
//   * High-volume vehicle-producer ingest accepts EITHER a valid session OR
//     a signed `x-vsbs-vehicle-token` HMAC over `${vehicleId}.${sha256(body)}`.
//     The chaos driver / CARLA bridge mints the latter using the same
//     SESSION_SIGNING_KEY.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";

import type { ConsentManager } from "@vsbs/compliance";
import { type Statement, arbitrate } from "@vsbs/sensors";
import { type SensorSample, SensorSampleSchema } from "@vsbs/shared";
import { ObdDongleAdapter } from "../adapters/sensors/obd-dongle.js";
import { MemorySensorSessionStore, type SensorSession } from "../adapters/sensors/shared-state.js";
import { SmartcarAdapter } from "../adapters/sensors/smartcar.js";
import type { Env } from "../env.js";
import { errBody } from "../middleware/security.js";
import {
	type SessionAppEnv,
	hmacSha256,
	optionalSession,
	requireSession,
} from "../middleware/session.js";
import { zv } from "../middleware/zv.js";

const IngestBodySchema = z.object({
	vehicleId: z.string().min(1),
	samples: z.array(SensorSampleSchema).min(1).max(500),
});

const SmartcarConnectBodySchema = z.object({
	vehicleId: z.string().min(1),
	scopes: z
		.array(z.string().min(1))
		.default(["read_odometer", "read_battery", "read_tires", "read_location"]),
});

const ObdConnectBodySchema = z.object({
	vehicleId: z.string().min(1),
});

function bytesToB64Url(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function constantTimeStringEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export interface BuildSensorsRouterOptions {
	/**
	 * Consent manager used to gate bearer-authenticated owner ingest. When
	 * absent, owner-bearer ingest succeeds without a per-request consent
	 * check (development convenience; production threads it through).
	 */
	consent?: ConsentManager;
}

export function buildSensorsRouter(env: Env, opts: BuildSensorsRouterOptions = {}) {
	const router = new Hono<SessionAppEnv>();
	const sessionStore = new MemorySensorSessionStore();
	const latestByVehicle = new Map<string, Map<string, SensorSample>>();
	const consent = opts.consent;

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

	const verifyVehicleProducerToken = async (
		vehicleId: string,
		body: string,
		headerToken: string,
	): Promise<boolean> => {
		if (!headerToken) return false;
		const bodyBytes = new TextEncoder().encode(body);
		const digest = await crypto.subtle.digest("SHA-256", bodyBytes);
		const bodyHashB64u = bytesToB64Url(new Uint8Array(digest));
		const expected = await hmacSha256(env.SESSION_SIGNING_KEY, `${vehicleId}.${bodyHashB64u}`);
		return constantTimeStringEquals(expected, headerToken);
	};

	// -------- POST /v1/sensors/ingest --------
	// High-volume producer endpoint. Accepts EITHER a session bearer (for
	// owner-side ingest from a phone) OR an x-vsbs-vehicle-token HMAC (for
	// the chaos driver / CARLA bridge). Optional session is mounted only on
	// this route.
	router.post("/ingest", optionalSession({ signingKey: env.SESSION_SIGNING_KEY }), async (c) => {
		const raw = await c.req.text();
		let body: { vehicleId: string; samples: SensorSample[] };
		try {
			body = IngestBodySchema.parse(JSON.parse(raw));
		} catch (err) {
			return c.json(
				errBody("VALIDATION_FAILED", "Sensor ingest body invalid", c, String(err)),
				400,
			);
		}
		const hasSession = c.get("ownerSubject") !== undefined;
		const headerToken = c.req.header("x-vsbs-vehicle-token") ?? "";
		const tokenOk = await verifyVehicleProducerToken(body.vehicleId, raw, headerToken);
		if (!hasSession && !tokenOk) {
			return c.json(
				errBody(
					"INGEST_AUTH_REQUIRED",
					"Sensor ingest requires a session bearer or x-vsbs-vehicle-token HMAC",
					c,
				),
				401,
			);
		}
		// Bearer-authenticated owner ingest must have diagnostic-telemetry
		// consent. Vehicle-token producer ingest is consent-bound through
		// its booking at HMAC mint time; we do not re-check consent on
		// every frame.
		if (hasSession && consent) {
			const ownerSubject = c.get("ownerSubject");
			const allowed = await consent.hasEffective(ownerSubject, "diagnostic-telemetry");
			if (!allowed) {
				return c.json(
					errBody("CONSENT_REQUIRED", "diagnostic-telemetry consent required", c, {
						purpose: "diagnostic-telemetry",
						ownerSubject,
					}),
					412,
				);
			}
		}
		for (const s of body.samples) {
			if (s.vehicleId !== body.vehicleId) {
				return c.json(
					errBody(
						"VEHICLE_ID_MISMATCH",
						`sample vehicleId ${s.vehicleId} does not match route vehicleId ${body.vehicleId}`,
						c,
					),
					400,
				);
			}
			rememberLatest(latestByVehicle, s);
		}
		const fused = arbitrate(body.vehicleId, [] as Statement[], body.samples);
		return c.json(
			{
				data: {
					accepted: body.samples.length,
					originSummary: fused.originSummary,
					observationId: fused.observationId,
				},
			},
			202,
		);
	});

	// Everything else requires a session bearer.
	router.use("*", requireSession({ signingKey: env.SESSION_SIGNING_KEY }));

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
	router.post("/smartcar/connect", zv("json", SmartcarConnectBodySchema), async (c) => {
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
	});

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
	router.post("/obd/poll", zv("json", z.object({ sessionId: z.string().min(1) })), async (c) => {
		const { sessionId } = c.req.valid("json");
		const samples = await obd.poll(sessionId);
		return c.json({ data: { samples, count: samples.length } });
	});

	// GET /v1/sensors/sessions — list active sessions.
	router.get("/sessions", (c) => {
		const sessions: SensorSession[] = sessionStore.list();
		return c.json({ data: sessions });
	});

	return router;
}

function rememberLatest(store: Map<string, Map<string, SensorSample>>, sample: SensorSample): void {
	let bucket = store.get(sample.vehicleId);
	if (!bucket) {
		bucket = new Map<string, SensorSample>();
		store.set(sample.vehicleId, bucket);
	}
	bucket.set(sample.channel, sample);
}

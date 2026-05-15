// =============================================================================
// /v1/scenarios — orchestrator state surface for the CARLA demo loop.
//
// Author: Divya Mohan / dmj.one
// SPDX-License-Identifier: Apache-2.0
//
// The CARLA bridge owns the driving state machine; this server-side view
// is the *book-keeping* mirror that the web UI subscribes to. The bridge
// PUTs transitions; the UI receives them through SSE without polling.
// Stores are in-memory (sim/dev). A Firestore-backed store will swap
// behind the same interface for production.
// =============================================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
	type ConsentManager,
	DEFAULT_PURPOSE_REGISTRY,
	buildEvidenceHash,
	latestVersions,
} from "@vsbs/compliance";
import { type ConsentPurpose, ConsentPurposeSchema } from "@vsbs/shared";

import { errBody } from "../middleware/security.js";
import { type SessionAppEnv, requireSession } from "../middleware/session.js";
import { zv } from "../middleware/zv.js";

export const ScenarioFaultSchema = z.enum([
	"brake-pad-wear",
	"coolant-overheat",
	"hv-battery-imbalance",
	"tpms-dropout",
	"oil-low",
	"drive-belt-age",
]);
export type ScenarioFault = z.infer<typeof ScenarioFaultSchema>;

export const OrchestratorStateSchema = z.enum([
	"IDLE",
	"DRIVING_HOME_AREA",
	"FAULT_INJECTING",
	"BOOKING_PENDING",
	"AWAITING_GRANT",
	"DRIVING_TO_SC",
	"SERVICING",
	"AWAITING_RETURN_GRANT",
	"DRIVING_HOME",
	"DONE",
	"FAILED",
]);
export type OrchestratorState = z.infer<typeof OrchestratorStateSchema>;

export const ScenarioSchema = z.object({
	scenarioId: z.string().uuid(),
	vehicleId: z.string().min(1),
	fault: ScenarioFaultSchema,
	scCount: z.number().int().min(1).max(10),
	state: OrchestratorStateSchema,
	startedAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	bookingId: z.string().uuid().optional(),
	scId: z.string().min(1).optional(),
	outboundGrantId: z.string().uuid().optional(),
	returnGrantId: z.string().uuid().optional(),
	expectedDurationS: z.number().int().nonnegative(),
	plannedSteps: z.array(z.string()).default([]),
	history: z
		.array(
			z.object({
				state: OrchestratorStateSchema,
				at: z.string().datetime(),
				note: z.string().optional(),
			}),
		)
		.default([]),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export interface ScenarioStoreLike {
	put(scenario: Scenario): void;
	get(id: string): Scenario | undefined;
	list(): Scenario[];
	subscribe(id: string, listener: (s: Scenario) => void): () => void;
}

export class MemoryScenarioStore implements ScenarioStoreLike {
	readonly #scenarios = new Map<string, Scenario>();
	readonly #subs = new Map<string, Set<(s: Scenario) => void>>();

	put(scenario: Scenario): void {
		this.#scenarios.set(scenario.scenarioId, scenario);
		const listeners = this.#subs.get(scenario.scenarioId);
		if (listeners) {
			for (const fn of listeners) {
				try {
					fn(scenario);
				} catch {
					/* swallow listener errors */
				}
			}
		}
	}

	get(id: string): Scenario | undefined {
		return this.#scenarios.get(id);
	}

	list(): Scenario[] {
		return Array.from(this.#scenarios.values());
	}

	subscribe(id: string, listener: (s: Scenario) => void): () => void {
		let bucket = this.#subs.get(id);
		if (!bucket) {
			bucket = new Set();
			this.#subs.set(id, bucket);
		}
		bucket.add(listener);
		return () => {
			bucket?.delete(listener);
		};
	}
}

const PLANNED_STEPS: readonly string[] = [
	"DRIVING_HOME_AREA",
	"FAULT_INJECTING",
	"BOOKING_PENDING",
	"AWAITING_GRANT",
	"DRIVING_TO_SC",
	"SERVICING",
	"AWAITING_RETURN_GRANT",
	"DRIVING_HOME",
	"DONE",
];

const StartBodySchema = z.object({
	vehicleId: z.string().min(1),
	fault: ScenarioFaultSchema,
	scCount: z.number().int().min(1).max(10).default(3),
});

const TransitionBodySchema = z.object({
	state: OrchestratorStateSchema,
	note: z.string().max(500).optional(),
	bookingId: z.string().uuid().optional(),
	scId: z.string().min(1).optional(),
	outboundGrantId: z.string().uuid().optional(),
	returnGrantId: z.string().uuid().optional(),
});

const InjectFaultBodySchema = z.object({
	fault: ScenarioFaultSchema,
	note: z.string().max(500).optional(),
});

/**
 * Purposes the CARLA demo needs to clear the gate set on /v1/sensors/ingest,
 * /v1/intake/*, /v1/dispatch/*, /v1/payments/*, and /v1/autonomy/grant.
 * Names match `ConsentPurposeSchema` exactly; "service-fulfilment" covers the
 * service-booking + safety-decisions intent the team-lead asked us to seed.
 */
export const DEMO_BOOTSTRAP_PURPOSES: readonly ConsentPurpose[] = [
	"service-fulfilment",
	"diagnostic-telemetry",
	"autonomy-delegation",
	"autopay-within-cap",
	"voice-photo-processing",
] as const;

// Body no longer carries `userId` — identity is taken from the calling
// session's subject only. Sending a userId field is silently ignored
// (rejected by the strict schema).
const BootstrapConsentBodySchema = z
	.object({
		purposes: z.array(ConsentPurposeSchema).min(1).optional(),
		source: z.enum(["voice", "web", "mobile", "kiosk", "ivr"]).default("web"),
		locale: z.string().min(2).max(20).default("en"),
	})
	.strict();

export interface ScenariosRouterDeps {
	/** HMAC signing key for the session bearer (required for bootstrap-consent). */
	signingKey: string;
	/**
	 * Effective NODE_ENV. The bootstrap-consent route is unavailable in
	 * "production" regardless of demo-mode (404 SCENARIO_NOT_AVAILABLE).
	 */
	appEnv: "development" | "test" | "production";
	/** Demo mode flag (mirrors APP_DEMO_MODE). bootstrap-consent additionally requires this true. */
	demoMode: boolean;
	store?: ScenarioStoreLike;
	/** Wall-clock injector for tests; defaults to Date.now / new Date(). */
	now?: () => Date;
	/**
	 * Optional shared consent manager. When provided, the bootstrap-consent
	 * route writes through this manager so the gates on /v1/sensors/ingest
	 * etc. see the granted rows immediately. When omitted, the route returns
	 * 503 since there's no store to seed.
	 */
	consent?: ConsentManager;
}

export function buildScenariosRouter(deps: ScenariosRouterDeps) {
	const router = new Hono<SessionAppEnv>();
	const store = deps.store ?? new MemoryScenarioStore();
	const now = deps.now ?? (() => new Date());
	const consent = deps.consent;
	const bootstrapAvailable = deps.appEnv !== "production" && deps.demoMode === true;

	router.get("/", (c) => {
		return c.json({ data: { scenarios: store.list() } });
	});

	router.post(
		"/bootstrap-consent",
		requireSession({ signingKey: deps.signingKey }),
		zv("json", BootstrapConsentBodySchema),
		async (c) => {
			if (!bootstrapAvailable) {
				return c.json(
					errBody(
						"SCENARIO_NOT_AVAILABLE",
						"Demo bootstrap is not available in this environment.",
						c,
					),
					404,
				);
			}
			if (!consent) {
				return c.json(
					errBody(
						"CONSENT_MANAGER_UNAVAILABLE",
						"Bootstrap-consent requires a consent manager to be wired into the scenarios router.",
						c,
					),
					503,
				);
			}
			const body = c.req.valid("json");
			const userId = c.get("ownerSubject");
			const purposes = body.purposes ?? DEMO_BOOTSTRAP_PURPOSES;
			const versions = latestVersions();
			const granted: {
				purpose: ConsentPurpose;
				version: string;
				recordId: string;
			}[] = [];
			for (const purpose of purposes) {
				const desc = DEFAULT_PURPOSE_REGISTRY[purpose];
				const evidenceHash = await buildEvidenceHash(
					desc,
					body.locale,
					`${desc.description_en}\n${desc.description_hi}`,
				);
				const row = await consent.record({
					userId,
					purpose,
					version: versions[purpose],
					evidenceHash,
					source: body.source,
					ip_hash: "",
				});
				granted.push({ purpose, version: row.version, recordId: row.id });
			}
			return c.json(
				{
					data: {
						userId,
						purposes: granted,
						latestVersions: versions,
					},
				},
				201,
			);
		},
	);

	// ---------------------------------------------------------------------------
	// /test-drive/start — delegates the scenario to the chaos-driver Cloud Run
	// service. That service generates synthetic 10 Hz telemetry frames and 51
	// perception events and POSTs them back to this API at
	// /v1/autonomy/:bookingId/{telemetry,events}/ingest, which the autonomy
	// dashboard subscribes to via SSE. The chaos driver runs entirely in the
	// cloud — no local Python, no CARLA install, no host filesystem assumptions.
	//
	// Env contract:
	//   CHAOS_DRIVER_URL   — base URL of the chaos-driver Cloud Run service
	//                        (e.g. https://chaos.vsbs.dmj.one). Required.
	//   CHAOS_DRIVER_TOKEN — bearer token configured as ADMIN_RUN_TOKEN on the
	//                        chaos-driver service. Required.
	//   API_PUBLIC_URL     — the public base URL the chaos driver should POST
	//                        telemetry to (e.g. https://api.vsbs.dmj.one). If
	//                        unset, falls back to the request's own origin.
	//
	// The local in-memory queue is kept so a second click while a scenario is
	// still running gets a "queued, position N" response — same UX contract the
	// dashboard already renders.
	// ---------------------------------------------------------------------------

	const CHAOS_DRIVER_URL = (process.env.CHAOS_DRIVER_URL ?? "").replace(/\/$/, "");
	const CHAOS_DRIVER_TOKEN = process.env.CHAOS_DRIVER_TOKEN ?? "";
	const API_PUBLIC_URL = (process.env.API_PUBLIC_URL ?? "").replace(/\/$/, "");
	const SCENARIO_DURATION_S = Number.parseInt(
		process.env.CHAOS_SCENARIO_DURATION_S ?? "600",
		10,
	);

	type QueueEntry = {
		bookingId: string;
		queuedAt: number;
		coords: { lat: number; lng: number } | null;
	};
	type ActiveBridge = {
		bookingId: string;
		startedAt: number;
		jobId: string;
		endsAt: number;
	};
	let activeBridge: ActiveBridge | null = null;
	const queue: QueueEntry[] = [];

	function expireIfStale(): void {
		if (activeBridge && Date.now() > activeBridge.endsAt) {
			activeBridge = null;
			drainQueue();
		}
	}

	type StartCoords = { lat: number; lng: number } | null;
	type ActiveBridgeFull = ActiveBridge & { coords: StartCoords };
	const TestDriveStartSchema = z.object({
		lat: z.number().min(-90).max(90).optional(),
		lng: z.number().min(-180).max(180).optional(),
	});

	async function startScenario(
		bookingId: string,
		originBase: string,
		coords: StartCoords,
	): Promise<string> {
		if (!CHAOS_DRIVER_URL || !CHAOS_DRIVER_TOKEN) {
			throw new Error(
				"chaos driver not configured: set CHAOS_DRIVER_URL and CHAOS_DRIVER_TOKEN on the API service",
			);
		}
		const apiBase = API_PUBLIC_URL || originBase;
		const runBody: Record<string, unknown> = {
			bookingId,
			apiBase,
			scenarioId: "web-test-drive",
			seed: 42,
			speed: 1.0,
			durationS: SCENARIO_DURATION_S,
			loop: false,
		};
		if (coords) {
			runBody.lat = coords.lat;
			runBody.lng = coords.lng;
		}
		const res = await fetch(`${CHAOS_DRIVER_URL}/run`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${CHAOS_DRIVER_TOKEN}`,
			},
			body: JSON.stringify(runBody),
		});
		if (res.status !== 202) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`chaos driver rejected the run (HTTP ${res.status}): ${text.slice(0, 200)}`,
			);
		}
		const body = (await res.json()) as { jobId?: string };
		if (!body.jobId) throw new Error("chaos driver did not return a jobId");
		activeBridge = {
			bookingId,
			startedAt: Date.now(),
			jobId: body.jobId,
			endsAt: Date.now() + SCENARIO_DURATION_S * 1000 + 30_000,
		} as ActiveBridgeFull;
		(activeBridge as ActiveBridgeFull).coords = coords;
		return body.jobId;
	}

	function drainQueue(): void {
		if (activeBridge) return;
		const next = queue.shift();
		if (!next) return;
		startScenario(next.bookingId, API_PUBLIC_URL, next.coords).catch(() => {
			drainQueue();
		});
	}

	router.post("/test-drive/start", zv("json", TestDriveStartSchema), async (c) => {
		expireIfStale();
		const bookingId = crypto.randomUUID();
		if (!CHAOS_DRIVER_URL || !CHAOS_DRIVER_TOKEN) {
			return c.json(
				errBody(
					"CHAOS_DRIVER_NOT_CONFIGURED",
					"This deployment is missing CHAOS_DRIVER_URL or CHAOS_DRIVER_TOKEN.",
					c,
				),
				503,
			);
		}
		const parsed = c.req.valid("json");
		const coords: StartCoords =
			typeof parsed.lat === "number" && typeof parsed.lng === "number"
				? { lat: parsed.lat, lng: parsed.lng }
				: null;

		if (activeBridge) {
			queue.push({ bookingId, queuedAt: Date.now(), coords });
			return c.json(
				{
					data: {
						bookingId,
						dashboardUrl: `/autonomy/${bookingId}`,
						queued: true,
						position: queue.length,
						activeBookingId: activeBridge.bookingId,
					},
				},
				202,
			);
		}

		try {
			const originBase = new URL(c.req.url).origin;
			await startScenario(bookingId, originBase, coords);
		} catch (err) {
			return c.json(errBody("BRIDGE_SPAWN_FAILED", String(err), c), 500);
		}
		return c.json(
			{
				data: {
					bookingId,
					dashboardUrl: `/autonomy/${bookingId}`,
					queued: false,
				},
			},
			201,
		);
	});

	// Status endpoint so the dashboard can surface queue position before the
	// chaos driver starts producing frames.
	router.get(
		"/test-drive/:bookingId/status",
		zv("param", z.object({ bookingId: z.string().uuid() })),
		(c) => {
			expireIfStale();
			const { bookingId } = c.req.valid("param");
			if (activeBridge?.bookingId === bookingId) {
				return c.json({
					data: {
						bookingId,
						phase: "running",
						startedAt: new Date(activeBridge.startedAt).toISOString(),
					},
				});
			}
			const idx = queue.findIndex((q) => q.bookingId === bookingId);
			if (idx >= 0) {
				return c.json({
					data: {
						bookingId,
						phase: "queued",
						position: idx + 1,
						activeBookingId: activeBridge?.bookingId ?? null,
					},
				});
			}
			return c.json({ data: { bookingId, phase: "unknown" } });
		},
	);

	// SSE stub: the chaos driver runs in its own container, so its stdout/err
	// isn't reachable from this process. The dashboard's autonomy SSE
	// (telemetry + perception events) is the live signal; this endpoint sends
	// one informational event and closes so the UI's "log connected" indicator
	// resolves instead of hanging.
	router.get(
		"/test-drive/:bookingId/log/sse",
		zv("param", z.object({ bookingId: z.string().uuid() })),
		(c) => {
			const { bookingId } = c.req.valid("param");
			return streamSSE(c, async (stream) => {
				await stream.writeSSE({
					event: "log",
					data: `bookingId=${bookingId} bridge=cloud-run logs=Cloud Logging`,
				});
				await stream.writeSSE({
					event: "log",
					data: "Local bridge log tail is unavailable in cloud mode; telemetry SSE carries the live signal.",
				});
			});
		},
	);

	router.post("/carla-demo/start", zv("json", StartBodySchema), (c) => {
		const body = c.req.valid("json");
		const ts = now().toISOString();
		const scenario: Scenario = {
			scenarioId: crypto.randomUUID(),
			vehicleId: body.vehicleId,
			fault: body.fault,
			scCount: body.scCount,
			state: "IDLE",
			startedAt: ts,
			updatedAt: ts,
			expectedDurationS: 240,
			plannedSteps: PLANNED_STEPS.slice(),
			history: [{ state: "IDLE", at: ts, note: `Scenario primed for ${body.fault}.` }],
		};
		store.put(scenario);
		return c.json({ data: scenario }, 201);
	});

	router.post(
		"/:scenarioId/transition",
		zv("param", z.object({ scenarioId: z.string().uuid() })),
		zv("json", TransitionBodySchema),
		(c) => {
			const { scenarioId } = c.req.valid("param");
			const body = c.req.valid("json");
			const existing = store.get(scenarioId);
			if (!existing) {
				return c.json(errBody("SCENARIO_NOT_FOUND", "Unknown scenario id", c), 404);
			}
			const ts = now().toISOString();
			const next: Scenario = {
				...existing,
				state: body.state,
				updatedAt: ts,
				history: [
					...existing.history,
					{
						state: body.state,
						at: ts,
						...(body.note ? { note: body.note } : {}),
					},
				],
				...(body.bookingId ? { bookingId: body.bookingId } : {}),
				...(body.scId ? { scId: body.scId } : {}),
				...(body.outboundGrantId ? { outboundGrantId: body.outboundGrantId } : {}),
				...(body.returnGrantId ? { returnGrantId: body.returnGrantId } : {}),
			};
			store.put(next);
			return c.json({ data: next });
		},
	);

	router.post(
		"/:scenarioId/inject-fault",
		zv("param", z.object({ scenarioId: z.string().uuid() })),
		zv("json", InjectFaultBodySchema),
		(c) => {
			const { scenarioId } = c.req.valid("param");
			const body = c.req.valid("json");
			const existing = store.get(scenarioId);
			if (!existing) {
				return c.json(errBody("SCENARIO_NOT_FOUND", "Unknown scenario id", c), 404);
			}
			const ts = now().toISOString();
			const next: Scenario = {
				...existing,
				fault: body.fault,
				state: "FAULT_INJECTING",
				updatedAt: ts,
				history: [
					...existing.history,
					{
						state: "FAULT_INJECTING",
						at: ts,
						note: body.note ?? `manual fault inject: ${body.fault}`,
					},
				],
			};
			store.put(next);
			return c.json({ data: next });
		},
	);

	router.get("/:scenarioId", zv("param", z.object({ scenarioId: z.string().uuid() })), (c) => {
		const { scenarioId } = c.req.valid("param");
		const sc = store.get(scenarioId);
		if (!sc) return c.json(errBody("SCENARIO_NOT_FOUND", "Unknown scenario id", c), 404);
		return c.json({ data: sc });
	});

	router.get(
		"/:scenarioId/state",
		zv("param", z.object({ scenarioId: z.string().uuid() })),
		(c) => {
			const { scenarioId } = c.req.valid("param");
			const initial = store.get(scenarioId);
			if (!initial) {
				return c.json(errBody("SCENARIO_NOT_FOUND", "Unknown scenario id", c), 404);
			}
			return streamSSE(c, async (stream) => {
				await stream.writeSSE({
					event: "snapshot",
					data: JSON.stringify(initial),
				});
				let active = true;
				const cleanup = store.subscribe(scenarioId, (updated) => {
					if (!active) return;
					stream.writeSSE({ event: "transition", data: JSON.stringify(updated) }).catch(() => {
						active = false;
					});
				});
				try {
					for (let i = 0; i < 600 && active; i++) {
						const snapshot = store.get(scenarioId);
						if (snapshot && (snapshot.state === "DONE" || snapshot.state === "FAILED")) {
							await stream.writeSSE({
								event: "end",
								data: JSON.stringify(snapshot),
							});
							break;
						}
						await stream.sleep(1_000);
					}
				} finally {
					active = false;
					cleanup();
				}
			});
		},
	);

	return router;
}

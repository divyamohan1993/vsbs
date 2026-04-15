// =============================================================================
// Shared sensor-ingest state machine. Every sensor adapter (Smartcar, OBD
// dongle, future OEMs) walks a vehicle through the same lifecycle; the sim
// and live drivers of each adapter MUST drive this state machine with
// identical semantics. See docs/simulation-policy.md.
//
// States:
//   enrolled    — vehicle is registered; credentials not yet exchanged.
//   authorised  — access token held; vehicle has granted the requested scopes.
//   polling     — adapter is actively pulling samples.
//   paused      — polling temporarily suspended (token refresh, backoff).
//   degraded    — one or more channels reporting self-test failure.
//   disconnected— token revoked or device unpaired.
//
// Every transition is Zod-validated. Illegal transitions throw.
// =============================================================================

import { z } from "zod";

export const SensorSessionStateSchema = z.enum([
  "enrolled",
  "authorised",
  "polling",
  "paused",
  "degraded",
  "disconnected",
]);
export type SensorSessionState = z.infer<typeof SensorSessionStateSchema>;

export const SensorSessionEventSchema = z.enum([
  "authorise",
  "start-poll",
  "pause",
  "resume",
  "report-degraded",
  "recover",
  "disconnect",
  "refresh-token",
]);
export type SensorSessionEvent = z.infer<typeof SensorSessionEventSchema>;

export const SensorSessionSchema = z.object({
  sessionId: z.string().min(1),
  vehicleId: z.string().min(1),
  adapter: z.enum(["smartcar", "obd-dongle"]),
  mode: z.enum(["sim", "live"]),
  state: SensorSessionStateSchema,
  tokenFingerprint: z.string().optional(),
  tokenExpiresAt: z.string().datetime().optional(),
  scopes: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastError: z.string().optional(),
  pollCount: z.number().int().nonnegative().default(0),
  sampleCount: z.number().int().nonnegative().default(0),
});
export type SensorSession = z.infer<typeof SensorSessionSchema>;

const LEGAL: Record<SensorSessionState, Partial<Record<SensorSessionEvent, SensorSessionState>>> = {
  enrolled: {
    authorise: "authorised",
    disconnect: "disconnected",
  },
  authorised: {
    "start-poll": "polling",
    "refresh-token": "authorised",
    disconnect: "disconnected",
  },
  polling: {
    pause: "paused",
    "report-degraded": "degraded",
    "refresh-token": "polling",
    disconnect: "disconnected",
  },
  paused: {
    resume: "polling",
    disconnect: "disconnected",
  },
  degraded: {
    recover: "polling",
    pause: "paused",
    disconnect: "disconnected",
  },
  disconnected: {},
};

export function transition(
  session: SensorSession,
  event: SensorSessionEvent,
  patch: Partial<SensorSession> = {},
): SensorSession {
  const next = LEGAL[session.state][event];
  if (!next) {
    throw new Error(
      `illegal sensor-session transition ${session.state} --${event}--> for session ${session.sessionId}`,
    );
  }
  return SensorSessionSchema.parse({
    ...session,
    ...patch,
    state: next,
    updatedAt: new Date().toISOString(),
  });
}

export interface SensorSessionStore {
  get(sessionId: string): SensorSession | undefined;
  getByVehicle(vehicleId: string, adapter: SensorSession["adapter"]): SensorSession | undefined;
  put(session: SensorSession): void;
  list(): SensorSession[];
}

export class MemorySensorSessionStore implements SensorSessionStore {
  readonly #byId = new Map<string, SensorSession>();

  get(sessionId: string): SensorSession | undefined {
    return this.#byId.get(sessionId);
  }

  getByVehicle(vehicleId: string, adapter: SensorSession["adapter"]): SensorSession | undefined {
    for (const s of this.#byId.values()) {
      if (s.vehicleId === vehicleId && s.adapter === adapter) return s;
    }
    return undefined;
  }

  put(session: SensorSession): void {
    this.#byId.set(session.sessionId, session);
  }

  list(): SensorSession[] {
    return [...this.#byId.values()];
  }
}

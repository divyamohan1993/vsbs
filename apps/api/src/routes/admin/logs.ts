// =============================================================================
// /admin/logs/stream - Server-Sent Events feed of redacted, structured log
// entries. Admin-only via the existing IAP gate. Each line on the wire is a
// `data: {json}` event matching the LogEntry schema. The stream stays open
// for the life of the connection; the producer is a per-process ring buffer
// that captures every log line emitted via the @vsbs/telemetry logger.
// =============================================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { adminOnly, type AdminAppEnv } from "../../middleware/admin.js";
import { errBody } from "../../middleware/security.js";

// -----------------------------------------------------------------------------
// In-process ring buffer + SSE fan-out. We do not persist log entries here;
// Cloud Logging is the system of record. This buffer exists so the SIEM
// admin pane can show a live feed without round-tripping to Cloud Logging.
// -----------------------------------------------------------------------------

export const LogEntrySchema = z.object({
  ts: z.string().datetime(),
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
  severity: z.string(),
  msg: z.string(),
  service: z.string(),
  region: z.string(),
  request_id: z.string().optional(),
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  user_hash: z.string().optional(),
  tenant: z.string().optional(),
  // Free-form structured payload, scrubbed before insertion.
  fields: z.record(z.unknown()).optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

type Listener = (entry: LogEntry) => void;

export class LogBuffer {
  readonly #buffer: LogEntry[];
  readonly #listeners = new Set<Listener>();
  readonly #capacity: number;

  constructor(capacity = 1_000) {
    this.#capacity = capacity;
    this.#buffer = [];
  }

  push(entry: LogEntry): void {
    const parsed = LogEntrySchema.safeParse(entry);
    if (!parsed.success) return;
    this.#buffer.push(parsed.data);
    while (this.#buffer.length > this.#capacity) this.#buffer.shift();
    for (const l of this.#listeners) {
      try {
        l(parsed.data);
      } catch {
        // Bad listener - drop it so a misbehaving subscriber cannot stall the
        // feed for the rest. Server-side log goes through stdout normally.
        this.#listeners.delete(l);
      }
    }
  }

  recent(limit = 100): LogEntry[] {
    if (limit >= this.#buffer.length) return [...this.#buffer];
    return this.#buffer.slice(-limit);
  }

  subscribe(l: Listener): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }

  clear(): void {
    this.#buffer.length = 0;
  }
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

export interface AdminLogsRouterDeps {
  buffer: LogBuffer;
  appEnv: "development" | "test" | "production";
  adminAuthMode: "sim" | "live";
}

const StreamQuery = z.object({
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  q: z.string().max(200).optional(),
});

export function buildAdminLogsRouter(deps: AdminLogsRouterDeps) {
  const app = new Hono<AdminAppEnv>();

  app.use(
    "*",
    adminOnly({ mode: deps.adminAuthMode, appEnv: deps.appEnv }),
  );

  app.get("/recent", (c) => {
    const url = new URL(c.req.url);
    const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
    return c.json({ data: deps.buffer.recent(limit) });
  });

  app.get("/stream", async (c) => {
    const parse = StreamQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parse.success) {
      return c.json(errBody("VALIDATION_FAILED", "Invalid stream query", c, parse.error.flatten()), 400);
    }
    const { level, q } = parse.data;
    const matches = (e: LogEntry): boolean => {
      if (level !== undefined && e.level !== level) return false;
      if (q !== undefined && q.length > 0) {
        const hay = `${e.msg} ${JSON.stringify(e.fields ?? {})}`;
        if (!hay.toLowerCase().includes(q.toLowerCase())) return false;
      }
      return true;
    };
    return streamSSE(c, async (stream) => {
      // Flush a small backlog so the operator can see context immediately.
      for (const e of deps.buffer.recent(50)) {
        if (matches(e)) await stream.writeSSE({ data: JSON.stringify(e), event: "log" });
      }
      const queue: LogEntry[] = [];
      let resolveWaiter: (() => void) | null = null;
      const unsubscribe = deps.buffer.subscribe((e) => {
        if (!matches(e)) return;
        queue.push(e);
        if (resolveWaiter) {
          const r = resolveWaiter;
          resolveWaiter = null;
          r();
        }
      });
      try {
        // Heartbeat every 15 s so proxies do not idle the connection.
        const heartbeat = setInterval(() => {
          stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => undefined);
        }, 15_000);
        try {
          while (!stream.aborted) {
            if (queue.length === 0) {
              await new Promise<void>((resolve) => {
                resolveWaiter = resolve;
              });
            }
            while (queue.length > 0) {
              const e = queue.shift()!;
              await stream.writeSSE({ data: JSON.stringify(e), event: "log" });
            }
          }
        } finally {
          clearInterval(heartbeat);
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return app;
}

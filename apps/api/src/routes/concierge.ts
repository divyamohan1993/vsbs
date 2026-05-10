// =============================================================================
// /v1/concierge/turn — SSE endpoint that drives the LangGraph supervisor.
//
// Flow:
//   1. Client POSTs { userMessage, conversationId, vehicleId? }.
//   2. We load the thread history (in-process Map, Firestore-ready
//      interface) and append the new user message.
//   3. buildVsbsGraph(...).runTurn() yields AgentEvents — we relay each
//      one as an SSE `data:` line.
//   4. On `final` we persist the assistant message back to the thread.
//
// Threads are owner-bound. The first call to `/turn` for a conversationId
// claims the thread for the calling subject; later calls (turn or thread
// read) by a different subject get 403 THREAD_FORBIDDEN. Owner identity
// comes from `c.var.ownerSubject` set by `requireSession`.
//
// The same code path runs whether LLM_PROFILE=sim (scripted), demo
// (Google AI Studio), or prod (Vertex). Only the registry bindings
// differ. See docs/simulation-policy.md.
// =============================================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { type AgentEvent, type ConciergeTurnInput, buildVsbsGraph } from "@vsbs/agents";
import { type LlmEnv, type LlmMessage, LlmRegistry } from "@vsbs/llm";

import type { Env } from "../env.js";
import { errBody } from "../middleware/security.js";
import { type SessionAppEnv, requireSession } from "../middleware/session.js";
import { zv } from "../middleware/zv.js";

/** Domain error raised when a thread is accessed by a non-owner subject. */
export class ThreadForbiddenError extends Error {
	readonly threadId: string;
	constructor(threadId: string) {
		super(`Thread '${threadId}' is owned by a different subject`);
		this.name = "ThreadForbiddenError";
		this.threadId = threadId;
	}
}

/** Thread store interface — memory today, Firestore-swap-ready. */
export interface ThreadStore {
	/** Returns the thread's messages if the subject owns it, undefined if it does not exist. */
	get(id: string, ownerSubject: string): LlmMessage[] | undefined;
	/**
	 * Appends messages. The first append for a given id binds the subject;
	 * subsequent appends from a different subject throw ThreadForbiddenError.
	 */
	append(id: string, ownerSubject: string, messages: LlmMessage[]): void;
}

interface ThreadRecord {
	ownerSubject: string;
	messages: LlmMessage[];
}

export class MemoryThreadStore implements ThreadStore {
	readonly #threads = new Map<string, ThreadRecord>();

	/** True if the thread exists at all (any owner). Used by the route to decide 403 vs 404. */
	exists(id: string): boolean {
		return this.#threads.has(id);
	}

	get(id: string, ownerSubject: string): LlmMessage[] | undefined {
		const record = this.#threads.get(id);
		if (!record) return undefined;
		if (record.ownerSubject !== ownerSubject) {
			throw new ThreadForbiddenError(id);
		}
		return record.messages;
	}

	append(id: string, ownerSubject: string, messages: LlmMessage[]): void {
		const existing = this.#threads.get(id);
		if (!existing) {
			this.#threads.set(id, { ownerSubject, messages: [...messages] });
			return;
		}
		if (existing.ownerSubject !== ownerSubject) {
			throw new ThreadForbiddenError(id);
		}
		existing.messages.push(...messages);
	}
}

const TurnRequestSchema = z.object({
	conversationId: z.string().min(1).max(200),
	userMessage: z.string().min(1).max(8_000),
	vehicleId: z.string().max(200).optional(),
});

export interface ConciergeRouterOptions {
	/** Inject a custom store (tests). Defaults to a per-router MemoryThreadStore. */
	store?: ThreadStore & { exists?: (id: string) => boolean };
}

export function buildConciergeRouter(env: Env, opts: ConciergeRouterOptions = {}) {
	const router = new Hono<SessionAppEnv>();
	const store = opts.store ?? new MemoryThreadStore();

	router.use("*", requireSession({ signingKey: env.SESSION_SIGNING_KEY }));

	// The LLM registry is constructed lazily on first turn so we don't
	// pay the cost at startup when nobody is talking to the concierge.
	// The graph itself must be built per-request because each request
	// forwards the caller's Authorization bearer into the agent tool
	// HTTP client, so authenticated tool callbacks (intake, dispatch,
	// payment, autonomy, sensors) carry the same identity that
	// `requireSession` already verified for this request.
	let registry: LlmRegistry | null = null;
	function ensureRegistry(): LlmRegistry {
		if (registry) return registry;
		const llmEnv: LlmEnv = {
			LLM_PROFILE: env.LLM_PROFILE,
			...(env.GOOGLE_AI_STUDIO_API_KEY !== undefined
				? { GOOGLE_AI_STUDIO_API_KEY: env.GOOGLE_AI_STUDIO_API_KEY }
				: {}),
			GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT,
			VERTEX_AI_LOCATION: env.VERTEX_AI_LOCATION,
			...(env.ANTHROPIC_API_KEY !== undefined ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
			...(env.OPENAI_API_KEY !== undefined ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
		};
		registry = new LlmRegistry(llmEnv);
		return registry;
	}
	function handle(authorization: string | undefined): ReturnType<typeof buildVsbsGraph> {
		// Tool definitions in @vsbs/agents already carry the `/v1/...` prefix
		// on every path, so apiBase is the server root.
		const apiBase = `http://localhost:${process.env.PORT ?? "8787"}`;
		return buildVsbsGraph({
			llm: ensureRegistry(),
			apiBase,
			...(authorization ? { defaultHeaders: { authorization } } : {}),
		});
	}

	router.post("/turn", zv("json", TurnRequestSchema), async (c) => {
		const { conversationId, userMessage, vehicleId } = c.req.valid("json");
		const ownerSubject = c.get("ownerSubject");

		// Owner-binding pre-flight. If the thread already exists with a
		// different owner, refuse before touching the graph.
		let priorMessages: LlmMessage[];
		try {
			priorMessages = store.get(conversationId, ownerSubject) ?? [];
		} catch (err) {
			if (err instanceof ThreadForbiddenError) {
				return c.json(
					errBody("THREAD_FORBIDDEN", "This conversation belongs to a different subject.", c, {
						conversationId,
					}),
					403,
				);
			}
			throw err;
		}

		const userMsg: LlmMessage = { role: "user", content: userMessage };
		const input: ConciergeTurnInput =
			vehicleId !== undefined
				? { conversationId, userMessage, vehicleId }
				: { conversationId, userMessage };
		const authorization = c.req.header("authorization");

		return streamSSE(c, async (stream) => {
			const emittedMessages: LlmMessage[] = [userMsg];
			try {
				for await (const event of handle(authorization).runTurn(
					{ messages: [...priorMessages, userMsg] },
					input,
				)) {
					await stream.writeSSE({
						event: event.type,
						data: JSON.stringify(event),
					});
					if (event.type === "final") {
						emittedMessages.push(event.message);
					}
				}
				await stream.writeSSE({
					event: "end",
					data: JSON.stringify({ ok: true }),
				});
			} catch (err) {
				const errEvent: AgentEvent = {
					type: "error",
					code: "CONCIERGE_FAILURE",
					message: String(err),
				};
				await stream.writeSSE({
					event: "error",
					data: JSON.stringify(errEvent),
				});
			} finally {
				try {
					store.append(conversationId, ownerSubject, emittedMessages);
				} catch (err) {
					// Owner bound to a different subject between pre-flight and
					// append (race). Drop only the ThreadForbiddenError on the
					// floor — the SSE stream has already been emitted to the
					// rightful caller, and the thread state cannot be silently
					// corrupted. Anything else must propagate; the rethrow is
					// intentional even inside `finally`.
					// biome-ignore lint/correctness/noUnsafeFinally: deliberate rethrow of unknown errors; ThreadForbiddenError is the only swallowed class
					if (!(err instanceof ThreadForbiddenError)) throw err;
				}
			}
		});
	});

	router.get("/threads/:id", (c) => {
		const id = c.req.param("id");
		const ownerSubject = c.get("ownerSubject");
		try {
			const messages = store.get(id, ownerSubject);
			if (messages === undefined) {
				return c.json(errBody("THREAD_NOT_FOUND", "No such concierge thread.", c, { id }), 404);
			}
			return c.json({ data: { id, messages } });
		} catch (err) {
			if (err instanceof ThreadForbiddenError) {
				return c.json(
					errBody("THREAD_FORBIDDEN", "This conversation belongs to a different subject.", c, {
						id,
					}),
					403,
				);
			}
			throw err;
		}
	});

	return router;
}

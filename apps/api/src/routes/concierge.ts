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
// The same code path runs whether LLM_PROFILE=sim (scripted), demo
// (Google AI Studio), or prod (Vertex). Only the registry bindings
// differ. See docs/simulation-policy.md.
// =============================================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  LlmRegistry,
  type LlmEnv,
  type LlmMessage,
} from "@vsbs/llm";
import {
  buildVsbsGraph,
  type AgentEvent,
  type ConciergeTurnInput,
} from "@vsbs/agents";

import type { Env } from "../env.js";
import type { AppEnv } from "../middleware/security.js";
import { zv } from "../middleware/zv.js";

/** Thread store interface — memory today, Firestore-swap-ready. */
export interface ThreadStore {
  get(id: string): LlmMessage[];
  append(id: string, messages: LlmMessage[]): void;
}

class MemoryThreadStore implements ThreadStore {
  readonly #threads = new Map<string, LlmMessage[]>();
  get(id: string): LlmMessage[] {
    return this.#threads.get(id) ?? [];
  }
  append(id: string, messages: LlmMessage[]): void {
    const prior = this.#threads.get(id) ?? [];
    this.#threads.set(id, [...prior, ...messages]);
  }
}

const TurnRequestSchema = z.object({
  conversationId: z.string().min(1).max(200),
  userMessage: z.string().min(1).max(8_000),
  vehicleId: z.string().max(200).optional(),
});

export function buildConciergeRouter(env: Env) {
  const router = new Hono<AppEnv>();
  const store: ThreadStore = new MemoryThreadStore();

  // The LLM registry + graph are constructed lazily the first time a
  // turn fires so we don't pay the cost at startup when nobody is
  // talking to the concierge.
  let graphHandle: ReturnType<typeof buildVsbsGraph> | null = null;
  function handle(): ReturnType<typeof buildVsbsGraph> {
    if (graphHandle) return graphHandle;
    const llmEnv: LlmEnv = {
      LLM_PROFILE: env.LLM_PROFILE,
      ...(env.GOOGLE_AI_STUDIO_API_KEY !== undefined ? { GOOGLE_AI_STUDIO_API_KEY: env.GOOGLE_AI_STUDIO_API_KEY } : {}),
      GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT,
      VERTEX_AI_LOCATION: env.VERTEX_AI_LOCATION,
      ...(env.ANTHROPIC_API_KEY !== undefined ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
      ...(env.OPENAI_API_KEY !== undefined ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
    };
    const registry = new LlmRegistry(llmEnv);
    // Tool definitions in @vsbs/agents already carry the `/v1/...` prefix
    // on every path, so apiBase is the server root.
    const apiBase = `http://localhost:${process.env.PORT ?? "8787"}`;
    graphHandle = buildVsbsGraph({ llm: registry, apiBase });
    return graphHandle;
  }

  router.post(
    "/turn",
    zv("json", TurnRequestSchema),
    async (c) => {
      const { conversationId, userMessage, vehicleId } = c.req.valid("json");
      const priorMessages = store.get(conversationId);
      const userMsg: LlmMessage = { role: "user", content: userMessage };
      const input: ConciergeTurnInput = vehicleId !== undefined
        ? { conversationId, userMessage, vehicleId }
        : { conversationId, userMessage };

      return streamSSE(c, async (stream) => {
        const emittedMessages: LlmMessage[] = [userMsg];
        try {
          for await (const event of handle().runTurn(
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
          store.append(conversationId, emittedMessages);
        }
      });
    },
  );

  router.get("/threads/:id", (c) => {
    const id = c.req.param("id");
    return c.json({ data: { id, messages: store.get(id) } });
  });

  return router;
}

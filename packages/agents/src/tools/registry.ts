// =============================================================================
// ToolRegistry — the single source of truth for every tool the agents can
// invoke. Each tool:
//   • declares a Zod input schema (args);
//   • compiles it to JSON Schema at registration time so the LLM layer can
//     pass it in the `tools` field of a completion request;
//   • runs via an injected fetch-based HTTP client against the VSBS API;
//   • returns a structured ToolResult.
//
// CRITICAL CONTRACT: validation happens *inside* the registry before the
// tool's handler fires. A validation failure never reaches the network.
// On failure the result is `{ ok: false, reason: "invalid-args", issues }`
// so the supervisor can re-plan without a silent retry.
// =============================================================================

import { z, type ZodTypeAny } from "zod";
import type { LlmTool, LlmToolCall } from "@vsbs/llm";
import type { ToolResult } from "../types.js";

/** Minimal HTTP client interface — fetch-based, base URL injected. */
export interface VsbsHttpClient {
  readonly baseUrl: string;
  get(path: string, init?: RequestInit): Promise<Response>;
  post(path: string, body: unknown, init?: RequestInit): Promise<Response>;
}

/** Per-tool handler — receives already-validated args + the HTTP client. */
export type ToolHandler<A> = (
  args: A,
  http: VsbsHttpClient,
  ctx: { signal?: AbortSignal },
) => Promise<unknown>;

export interface ToolDefinition<S extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  argsSchema: S;
  /** JSON Schema (draft 2020-12 compatible object) for the LLM tools field. */
  jsonSchema: Record<string, unknown>;
  handler: ToolHandler<z.infer<S>>;
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();
  readonly #http: VsbsHttpClient;

  constructor(http: VsbsHttpClient) {
    this.#http = http;
  }

  register<S extends ZodTypeAny>(def: {
    name: string;
    description: string;
    argsSchema: S;
    handler: ToolHandler<z.infer<S>>;
  }): void {
    if (this.#tools.has(def.name)) {
      throw new Error(`ToolRegistry: duplicate tool name "${def.name}"`);
    }
    this.#tools.set(def.name, {
      name: def.name,
      description: def.description,
      argsSchema: def.argsSchema,
      jsonSchema: zodToJsonSchemaObject(def.argsSchema),
      handler: def.handler as ToolHandler<unknown>,
    } as ToolDefinition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  /** Snapshot of all tool descriptors suitable for @vsbs/llm `LlmRequest.tools`. */
  llmTools(): LlmTool[] {
    const out: LlmTool[] = [];
    for (const def of this.#tools.values()) {
      out.push({
        name: def.name,
        description: def.description,
        inputSchema: def.jsonSchema,
      });
    }
    return out;
  }

  /** Names of all registered tools — stable ordering by insertion. */
  names(): string[] {
    return Array.from(this.#tools.keys());
  }

  /**
   * Run a tool call end-to-end: validate args, invoke handler, time it,
   * package the ToolResult. Never throws — all errors become structured
   * failure results so the supervisor can read them as model input.
   */
  async run(
    call: LlmToolCall,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const started = Date.now();
    const def = this.#tools.get(call.name);
    if (!def) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        ok: false,
        reason: "unknown-tool",
        latencyMs: Date.now() - started,
      };
    }
    const parsed = def.argsSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        ok: false,
        reason: "invalid-args",
        issues: parsed.error.issues,
        latencyMs: Date.now() - started,
      };
    }
    try {
      const ctx: { signal?: AbortSignal } = {};
      if (signal) ctx.signal = signal;
      const data = await def.handler(parsed.data, this.#http, ctx);
      return {
        toolCallId: call.id,
        toolName: call.name,
        ok: true,
        data,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        ok: false,
        reason: `handler-error: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - started,
      };
    }
  }
}

/**
 * Minimal fetch-backed HTTP client. Base URL is injected — the registry
 * never hardcodes localhost or env lookups. Timeouts and retries are the
 * handler's business; this layer is a thin transport.
 */
export function createHttpClient(baseUrl: string, defaultHeaders: Record<string, string> = {}): VsbsHttpClient {
  const trimmed = baseUrl.replace(/\/$/, "");
  const mergeHeaders = (extra?: HeadersInit): HeadersInit => {
    const h: Record<string, string> = { ...defaultHeaders };
    if (extra) {
      if (extra instanceof Headers) {
        extra.forEach((v, k) => {
          h[k] = v;
        });
      } else if (Array.isArray(extra)) {
        for (const [k, v] of extra) h[k] = v;
      } else {
        Object.assign(h, extra);
      }
    }
    return h;
  };
  return {
    baseUrl: trimmed,
    async get(path, init) {
      const headers = mergeHeaders(init?.headers);
      return fetch(`${trimmed}${path}`, { ...init, method: "GET", headers });
    },
    async post(path, body, init) {
      const headers = mergeHeaders({
        "content-type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      });
      return fetch(`${trimmed}${path}`, {
        ...init,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    },
  };
}

// -----------------------------------------------------------------------------
// Zod → JSON Schema (object-root only)
//
// The agents package avoids the heavyweight `zod-to-json-schema` dependency.
// Every agent tool uses an object-shaped args schema, so a bespoke walker is
// enough and keeps the supply chain minimal. Supported: z.object, z.string,
// z.number, z.boolean, z.enum, z.array, z.literal, z.union, z.record,
// z.optional, z.nullable, z.tuple, z.any, z.unknown. Anything more exotic
// falls back to `{}` (accept-all) rather than silently misrepresenting.
// -----------------------------------------------------------------------------

function zodToJsonSchemaObject(schema: ZodTypeAny): Record<string, unknown> {
  return walk(schema);
}

function walk(schema: ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName?: string } })._def;
  const tn = def?.typeName;
  switch (tn) {
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = walk(child);
        if (!isOptional(child)) required.push(key);
      }
      const out: Record<string, unknown> = {
        type: "object",
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) out["required"] = required;
      return out;
    }
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum": {
      const values = (schema as unknown as { _def: { values: string[] } })._def.values;
      return { type: "string", enum: values };
    }
    case "ZodNativeEnum": {
      const values = Object.values(
        (schema as unknown as { _def: { values: Record<string, string | number> } })._def.values,
      );
      return { enum: values };
    }
    case "ZodArray": {
      const inner = (schema as unknown as { _def: { type: ZodTypeAny } })._def.type;
      return { type: "array", items: walk(inner) };
    }
    case "ZodTuple": {
      const items = (schema as unknown as { _def: { items: ZodTypeAny[] } })._def.items.map(walk);
      return { type: "array", prefixItems: items, minItems: items.length, maxItems: items.length };
    }
    case "ZodLiteral": {
      const value = (schema as unknown as { _def: { value: unknown } })._def.value;
      return { const: value };
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = (schema as unknown as { _def: { options: ZodTypeAny[] } })._def.options;
      return { anyOf: options.map(walk) };
    }
    case "ZodRecord": {
      const valueType = (schema as unknown as { _def: { valueType: ZodTypeAny } })._def.valueType;
      return { type: "object", additionalProperties: walk(valueType) };
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault": {
      const inner = (schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType;
      return walk(inner);
    }
    case "ZodEffects": {
      const inner = (schema as unknown as { _def: { schema: ZodTypeAny } })._def.schema;
      return walk(inner);
    }
    case "ZodAny":
    case "ZodUnknown":
      return {};
    default:
      return {};
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const tn = (schema as unknown as { _def: { typeName?: string } })._def?.typeName;
  if (tn === "ZodOptional" || tn === "ZodDefault") return true;
  if (tn === "ZodNullable") {
    const inner = (schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType;
    return isOptional(inner);
  }
  return false;
}

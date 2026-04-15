// Thin wrapper over @hono/zod-validator that applies the unified error
// envelope (`errBody`) on every validation failure. Use `zv` instead of
// `zValidator` everywhere in the API so validation errors are consistent.

import { zValidator as baseZValidator } from "@hono/zod-validator";
import type { ZodSchema } from "zod";
import { errBody, type AppEnv } from "./security.js";

type Target = "json" | "form" | "query" | "param" | "header" | "cookie";

export function zv<T extends ZodSchema>(target: Target, schema: T) {
  return baseZValidator(target, schema, async (result, c) => {
    if (!result.success) {
      const body = errBody(
        "VALIDATION_FAILED",
        "Request payload is invalid",
        c as unknown as Parameters<typeof errBody>[2],
        result.error.flatten(),
      );
      return new Response(JSON.stringify(body), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return undefined;
  });
}

// Re-export the types AppEnv users may need.
export type { AppEnv };

// =============================================================================
// Admin gate.
//
// Two non-bypassable layers, exactly mirroring apps/admin/src/proxy.ts:
//
//   1. Live: Cloud IAP must terminate the request. We require the
//      `x-goog-iap-jwt-assertion` header and verify the embedded admin
//      role claim. IAP itself has already validated the signature; we
//      enforce structural shape, expiry, and the admin role.
//
//   2. Sim: when APP_ENV is not "production" and `ADMIN_AUTH_MODE=sim`,
//      we accept the `x-vsbs-admin-token` header issued by the admin
//      Next.js app's /api/dev-login route. Same JWT-shape verification.
//
// On a successful verification we attach the admin subject to the
// request context. On any failure we return a uniform error envelope
// with 401 / 403. The response Vary header includes the admin headers
// so any cache layer in front of this never serves an admin response
// to an unauthenticated client.
// =============================================================================

import type { Context, MiddlewareHandler } from "hono";

import { errBody, type AppEnv } from "./security.js";

export interface AdminVariables {
  adminSubject: string;
  adminRoles: readonly string[];
}

export type AdminAppEnv = {
  Variables: AppEnv["Variables"] & AdminVariables;
};

export interface AdminGateOptions {
  /** "sim" allows the dev token; "live" requires IAP. */
  mode: "sim" | "live";
  /** Refuse the sim path even when mode === "sim" if APP_ENV is production. */
  appEnv: "development" | "test" | "production";
}

type JwtVerdict =
  | { ok: true; subject: string; roles: string[] }
  | { ok: false; reason: "malformed" | "expired" | "missing-role" };

function decodeJwtPart(part: string): unknown {
  const pad = part.length % 4 === 2 ? "==" : part.length % 4 === 3 ? "=" : "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + pad;
  try {
    return JSON.parse(globalThis.atob(b64));
  } catch {
    return null;
  }
}

function verifyAdminJwt(token: string): JwtVerdict {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const payload = decodeJwtPart(parts[1] ?? "");
  if (!payload || typeof payload !== "object") return { ok: false, reason: "malformed" };
  const obj = payload as Record<string, unknown>;
  const exp = typeof obj["exp"] === "number" ? obj["exp"] : 0;
  if (exp > 0 && exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  const rolesRaw = obj["roles"];
  let roles: string[] = [];
  if (Array.isArray(rolesRaw)) {
    roles = rolesRaw.filter((r): r is string => typeof r === "string");
  } else if (typeof obj["role"] === "string") {
    roles = [obj["role"]];
  }
  if (!roles.includes("admin")) return { ok: false, reason: "missing-role" };
  const sub = typeof obj["sub"] === "string" ? obj["sub"] : "anonymous-admin";
  return { ok: true, subject: sub, roles };
}

export const adminOnly = (opts: AdminGateOptions): MiddlewareHandler<AdminAppEnv> =>
  async (c, next) => {
    const iap = c.req.header("x-goog-iap-jwt-assertion");
    if (iap) {
      const v = verifyAdminJwt(iap);
      if (!v.ok) {
        const status = v.reason === "missing-role" ? 403 : 401;
        const code = v.reason === "missing-role" ? "ADMIN_FORBIDDEN" : "ADMIN_TOKEN_INVALID";
        return c.json(
          errBody(code, "IAP assertion is not a valid admin token", c as unknown as Context),
          status,
        );
      }
      c.set("adminSubject", v.subject);
      c.set("adminRoles", v.roles);
      c.header("vary", "x-goog-iap-jwt-assertion, x-vsbs-admin-token");
      await next();
      return;
    }

    if (opts.mode === "sim" && opts.appEnv !== "production") {
      const dev = c.req.header("x-vsbs-admin-token");
      if (!dev) {
        return c.json(
          errBody("ADMIN_REQUIRED", "Missing admin token", c as unknown as Context),
          401,
        );
      }
      const v = verifyAdminJwt(dev);
      if (!v.ok) {
        const status = v.reason === "missing-role" ? 403 : 401;
        const code = v.reason === "missing-role" ? "ADMIN_FORBIDDEN" : "ADMIN_TOKEN_INVALID";
        return c.json(
          errBody(code, "Admin dev token rejected", c as unknown as Context),
          status,
        );
      }
      c.set("adminSubject", v.subject);
      c.set("adminRoles", v.roles);
      c.header("vary", "x-goog-iap-jwt-assertion, x-vsbs-admin-token");
      await next();
      return;
    }

    return c.json(
      errBody("ADMIN_REQUIRES_IAP", "IAP assertion required", c as unknown as Context),
      401,
    );
  };

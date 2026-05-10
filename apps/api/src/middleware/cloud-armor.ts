// =============================================================================
// Cloud Armor reflection middleware.
//
// Cloud Armor evaluates inbound traffic at the edge and stamps the verdict
// onto a header before the request reaches Cloud Run. The app respects the
// `block` verdict by short-circuiting with 403, the `throttle` verdict by
// applying a stricter app-level rate limit, and otherwise lets traffic
// through. This is the second-layer enforcement called for in
// docs/research/security.md §5.
//
// Production fail-closed posture: when `appEnv === "production"` and the
// caller did not explicitly set `requireHeader`, we default it to `true`.
// This closes finding F9 (development defaults reaching prod) — a request
// that arrives at Cloud Run without a Cloud Armor verdict in production
// has bypassed the edge and must be rejected.
//
// The Zod schema is the single source of truth for the accepted verdicts.
// =============================================================================

import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import { type AppEnv, errBody } from "./security.js";

export const CloudArmorActionSchema = z.enum(["allow", "throttle", "block", "challenge"]);
export type CloudArmorAction = z.infer<typeof CloudArmorActionSchema>;

export const CLOUD_ARMOR_HEADER = "x-cloud-armor-action";

export interface CloudArmorOptions {
	/** Set to true to fail-closed if the header is missing (defense-in-depth). */
	requireHeader?: boolean;
	/** Optional secondary header carrying the matching CRS rule id. */
	ruleHeader?: string;
	/**
	 * Application environment. When "production" and `requireHeader` is not
	 * explicitly set, the middleware fails closed if the verdict header is
	 * missing. Development and test default to fail-open as before.
	 */
	appEnv?: "development" | "test" | "production";
}

export function cloudArmor(opts: CloudArmorOptions = {}): MiddlewareHandler<AppEnv> {
	const requireHeader =
		opts.requireHeader !== undefined ? opts.requireHeader : opts.appEnv === "production";
	const ruleHeader = opts.ruleHeader ?? "x-cloud-armor-rule";
	return async (c, next) => {
		const raw = c.req.header(CLOUD_ARMOR_HEADER);
		if (!raw) {
			if (requireHeader) {
				return c.json(
					errBody("EDGE_VERDICT_MISSING", "Cloud Armor verdict header missing", c),
					403,
				);
			}
			await next();
			return;
		}
		const parsed = CloudArmorActionSchema.safeParse(raw);
		if (!parsed.success) {
			return c.json(errBody("EDGE_VERDICT_INVALID", "Cloud Armor verdict header invalid", c), 400);
		}
		const action = parsed.data;
		if (action === "block") {
			const rule = c.req.header(ruleHeader);
			return c.json(
				errBody(
					"EDGE_BLOCKED",
					"Request blocked by edge security policy",
					c,
					rule ? { rule } : undefined,
				),
				403,
			);
		}
		if (action === "challenge") {
			return c.json(errBody("EDGE_CHALLENGE_REQUIRED", "Edge challenge required", c), 401);
		}
		if (action === "throttle") {
			c.header("x-edge-throttle", "1");
		}
		await next();
	};
}

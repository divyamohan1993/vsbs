// =============================================================================
// /v1/region/me   GET   - returns { detected, pinned, allowedSwitch }
// /v1/region/switch POST - asks to switch the pinned region. 409 if there is
//                          a pending booking that would be left in the old
//                          region's data plane.
//
// Switching only changes the residency cookie + tenant; the API does not
// migrate user data across regions (residency policy forbids it). The web
// client will reload onto the new regional FQDN.
//
// Owner identity for "do you have pending bookings?" is read from the
// session (`c.var.ownerSubject`); there is no header or body fallback.
// =============================================================================

import { type Context, Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import type { RegionRouter } from "../adapters/region-router.js";
import { COOKIE_DEFAULT, RegionSchema, type VsbsRegion } from "../middleware/region.js";
import { errBody } from "../middleware/security.js";
import { type SessionAppEnv, requireSession } from "../middleware/session.js";
import { zv } from "../middleware/zv.js";

/** A read-only view of pending bookings, indexed by owner subject. */
export interface PendingBookingsView {
	hasPending(ownerId: string): boolean;
	countPending(ownerId: string): number;
}

/** Memory-backed implementation. Production swaps in a Firestore client. */
export class MemoryPendingBookings implements PendingBookingsView {
	readonly #byOwner = new Map<string, number>();
	hasPending(ownerId: string): boolean {
		return (this.#byOwner.get(ownerId) ?? 0) > 0;
	}
	countPending(ownerId: string): number {
		return this.#byOwner.get(ownerId) ?? 0;
	}
	/** Test/seed helper. */
	setPending(ownerId: string, n: number): void {
		this.#byOwner.set(ownerId, n);
	}
}

export interface RegionRouterDeps {
	/** HMAC signing key for the session bearer. Required. */
	signingKey: string;
	/** Router used to surface base URLs in the switch response. */
	router: RegionRouter;
	/** Pending bookings store (defaults to in-memory if omitted). */
	pending?: PendingBookingsView;
	/** Cookie name override (mostly for tests). */
	cookieName?: string;
}

const SwitchBodySchema = z.object({
	to: RegionSchema,
});

export function buildRegionRouter(deps: RegionRouterDeps) {
	const router = new Hono<SessionAppEnv>();
	const pending = deps.pending ?? new MemoryPendingBookings();
	const cookieName = deps.cookieName ?? COOKIE_DEFAULT;

	router.use("*", requireSession({ signingKey: deps.signingKey }));

	const ownerOf = (c: Context<SessionAppEnv>): string => c.get("ownerSubject");

	router.get("/me", (c) => {
		const decision = c.get("regionDecision");
		if (!decision) {
			return c.json(errBody("REGION_NOT_DECIDED", "Region middleware was not configured", c), 500);
		}
		const owner = ownerOf(c);
		const allowedSwitch = !pending.hasPending(owner);
		const known = deps.router.knownRegions();
		return c.json({
			data: {
				detected: decision.detected,
				pinned: decision.pinned,
				reason: decision.reason,
				country: decision.country ?? null,
				allowedSwitch,
				knownRegions: known,
				pendingBookings: pending.countPending(owner),
			},
		});
	});

	router.post("/switch", zv("json", SwitchBodySchema), (c) => {
		const body = c.req.valid("json");
		const decision = c.get("regionDecision");
		if (!decision) {
			return c.json(errBody("REGION_NOT_DECIDED", "Region middleware was not configured", c), 500);
		}
		const owner = ownerOf(c);

		if (pending.hasPending(owner)) {
			return c.json(
				errBody(
					"REGION_SWITCH_BLOCKED",
					"Cannot switch region while a booking is in progress. Cancel or complete it first.",
					c,
					{ pending: pending.countPending(owner), pinned: decision.pinned },
				),
				409,
			);
		}

		if (body.to === decision.pinned) {
			// No-op; still set the cookie so subsequent requests are sticky.
			setCookie(c, cookieName, body.to, {
				maxAge: 60 * 60 * 24 * 30,
				sameSite: "Lax",
				secure: true,
				httpOnly: false,
				path: "/",
			});
			return c.json({ data: { ok: true, pinned: body.to, changed: false } });
		}

		const newApiBase = deps.router.apiBaseUrl(body.to);
		const newWebBase = deps.router.webBaseUrl?.(body.to);

		setCookie(c, cookieName, body.to, {
			maxAge: 60 * 60 * 24 * 30,
			sameSite: "Lax",
			secure: true,
			httpOnly: false,
			path: "/",
		});

		return c.json({
			data: {
				ok: true,
				from: decision.pinned,
				pinned: body.to as VsbsRegion,
				changed: true,
				apiBaseUrl: newApiBase ?? null,
				webBaseUrl: newWebBase ?? null,
				message: "Cookie updated. Reload onto the regional FQDN to land on the new data plane.",
			},
		});
	});

	router.delete("/cookie", (c) => {
		deleteCookie(c, cookieName, { path: "/" });
		return c.json({ data: { ok: true } });
	});

	return router;
}

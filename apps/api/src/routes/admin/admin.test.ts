import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

import { type AdminAppEnv, signAdminDevToken } from "../../middleware/admin.js";
import { buildAdminRouter } from "./router.js";

const SIGN_KEY = "test-signing-key-must-be-at-least-32-chars-long";

let ADMIN_TOKEN = "";
let VIEWER_TOKEN = "";
let EXPIRED_TOKEN = "";

beforeAll(async () => {
	const admin = await signAdminDevToken(
		{ subject: "ops.dmj@vsbs.in", roles: ["admin"] },
		{ signingKey: SIGN_KEY, defaultTtlSeconds: 3600 },
	);
	ADMIN_TOKEN = admin.token;
	const viewer = await signAdminDevToken(
		{ subject: "ops.dmj@vsbs.in", roles: ["viewer"] },
		{ signingKey: SIGN_KEY, defaultTtlSeconds: 3600 },
	);
	VIEWER_TOKEN = viewer.token;
	// Force the exp claim into the past by signing then mutating: instead we
	// simply mint with a very small ttl and wait for it to expire.
	const expired = await signAdminDevToken(
		{ subject: "ops.dmj@vsbs.in", roles: ["admin"], ttlSeconds: 1 },
		{ signingKey: SIGN_KEY, defaultTtlSeconds: 1 },
	);
	EXPIRED_TOKEN = expired.token;
	await new Promise((r) => setTimeout(r, 1_100));
});

function makeApp() {
	const app = new Hono<AdminAppEnv>();
	app.use("*", async (c, next) => {
		c.set("requestId", "test-rid");
		await next();
	});
	app.route(
		"/v1/admin",
		buildAdminRouter({
			appEnv: "development",
			adminAuthMode: "sim",
			signingKey: SIGN_KEY,
		}),
	);
	return app;
}

async function fetchJson(
	app: ReturnType<typeof makeApp>,
	path: string,
	init?: RequestInit,
): Promise<{
	status: number;
	body: { data?: unknown; page?: unknown; error?: unknown };
}> {
	const res = await app.request(path, init);
	const body = await res.json();
	return {
		status: res.status,
		body: body as { data?: unknown; page?: unknown; error?: unknown },
	};
}

const adminHeaders = (): Record<string, string> => ({
	"x-vsbs-admin-token": ADMIN_TOKEN,
});
const jsonHeaders = (): Record<string, string> => ({
	"content-type": "application/json",
	"x-vsbs-admin-token": ADMIN_TOKEN,
});

describe("admin router gate", () => {
	it("rejects requests without admin token", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/bookings");
		expect(r.status).toBe(401);
		expect((r.body.error as { code: string }).code).toBe("ADMIN_REQUIRED");
	});

	it("rejects malformed admin token", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/bookings", {
			headers: { "x-vsbs-admin-token": "not.a.jwt" },
		});
		expect(r.status).toBe(401);
	});

	it("rejects token without admin role with 403", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/bookings", {
			headers: { "x-vsbs-admin-token": VIEWER_TOKEN },
		});
		expect(r.status).toBe(403);
		expect((r.body.error as { code: string }).code).toBe("ADMIN_FORBIDDEN");
	});

	it("accepts a valid admin token and returns bookings", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/bookings", {
			headers: adminHeaders(),
		});
		expect(r.status).toBe(200);
		const data = r.body.data as unknown[];
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBeGreaterThan(0);
		expect(r.body.page).toBeDefined();
	});

	it("supports cursor pagination on bookings", async () => {
		const app = makeApp();
		const first = await fetchJson(app, "/v1/admin/bookings?limit=10", {
			headers: adminHeaders(),
		});
		const firstData = first.body.data as Array<{ id: string }>;
		const firstPage = first.body.page as { nextCursor: string | null };
		expect(firstData.length).toBe(10);
		expect(firstPage.nextCursor).toBeTruthy();
		const second = await fetchJson(
			app,
			`/v1/admin/bookings?limit=10&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
			{ headers: adminHeaders() },
		);
		const secondData = second.body.data as Array<{ id: string }>;
		expect(secondData[0]?.id).not.toBe(firstData[0]?.id);
	});

	it("filters bookings by region", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/bookings?region=us-central1", {
			headers: adminHeaders(),
		});
		for (const b of r.body.data as Array<{ region: string }>) {
			expect(b.region).toBe("us-central1");
		}
	});

	it("returns capacity heatmap with cells and service centres", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/capacity/heatmap", {
			headers: adminHeaders(),
		});
		const data = r.body.data as { cells: unknown[]; serviceCentres: string[] };
		expect(Array.isArray(data.cells)).toBe(true);
		expect(data.serviceCentres.length).toBeGreaterThan(0);
	});

	it("re-runs router and updates optimised ETA", async () => {
		const app = makeApp();
		const list = await fetchJson(app, "/v1/admin/routing", {
			headers: adminHeaders(),
		});
		const id = (list.body.data as Array<{ routeId: string }>)[0]?.routeId;
		const r = await fetchJson(app, "/v1/admin/routing/rerun", {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({ routeIds: [id] }),
		});
		expect(r.status).toBe(200);
		expect((r.body.data as Array<{ routeId: string }>)[0]?.routeId).toBe(id);
	});

	it("creates and deletes a slot", async () => {
		const app = makeApp();
		const create = await fetchJson(app, "/v1/admin/slots", {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				scId: "sc-test-01",
				dayOfWeek: 2,
				start: "10:00",
				end: "12:00",
				capacity: 3,
				mode: "valet",
			}),
		});
		expect(create.status).toBe(201);
		const slotId = (create.body.data as { slotId: string }).slotId;
		const del = await fetchJson(app, `/v1/admin/slots/${encodeURIComponent(slotId)}`, {
			method: "DELETE",
			headers: adminHeaders(),
		});
		expect(del.status).toBe(200);
	});

	it("reassigns a booking and updates technician", async () => {
		const app = makeApp();
		const list = await fetchJson(app, "/v1/admin/bookings?limit=5", {
			headers: adminHeaders(),
		});
		const id = (list.body.data as Array<{ id: string }>)[0]?.id;
		const r = await fetchJson(app, `/v1/admin/bookings/${encodeURIComponent(id!)}/reassign`, {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				technicianId: "tech-arun",
				reason: "Manual reassign in test",
			}),
		});
		expect(r.status).toBe(200);
		const b = r.body.data as { technicianId: string; status: string };
		expect(b.technicianId).toBe("tech-arun");
		expect(b.status).toBe("assigned");
	});

	it("validates safety-overrides filters", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/safety-overrides?actorKind=agent", {
			headers: adminHeaders(),
		});
		for (const row of r.body.data as Array<{ actor: { kind: string } }>) {
			expect(row.actor.kind).toBe("agent");
		}
	});

	it("supports pricing transitions draft -> review -> published", async () => {
		const app = makeApp();
		const draft = await fetchJson(app, "/v1/admin/pricing/draft", {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				scId: "sc-blr-01",
				parts: [{ sku: "X1", name: "Test SKU", inr: 100 }],
				labour: [{ code: "L1", name: "Test labour", minutes: 10, inr: 50 }],
			}),
		});
		const versionId = (draft.body.data as { id: string }).id;
		const review = await fetchJson(app, "/v1/admin/pricing/transition", {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({ versionId, to: "review" }),
		});
		expect(review.status).toBe(200);
		const published = await fetchJson(app, "/v1/admin/pricing/transition", {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({ versionId, to: "published" }),
		});
		expect(published.status).toBe(200);
		const reject = await fetchJson(app, "/v1/admin/pricing/transition", {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({ versionId, to: "review" }),
		});
		expect(reject.status).toBe(409);
	});

	it("returns audit grant detail with merkle proof", async () => {
		const app = makeApp();
		const list = await fetchJson(app, "/v1/admin/audit/grants", {
			headers: adminHeaders(),
		});
		const grantId = (list.body.data as Array<{ grantId: string }>)[0]?.grantId;
		const detail = await fetchJson(app, `/v1/admin/audit/grants/${encodeURIComponent(grantId!)}`, {
			headers: adminHeaders(),
		});
		const body = detail.body.data as {
			grant: { grantId: string };
			inclusionProof: { rootHex: string };
		};
		expect(body.grant.grantId).toBe(grantId);
		expect(typeof body.inclusionProof.rootHex).toBe("string");
	});

	it("returns merkle authority roots", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/audit/merkle/roots", {
			headers: adminHeaders(),
		});
		const data = r.body.data as Array<{ rootHashHex: string }>;
		expect(data.length).toBeGreaterThan(0);
		expect(typeof data[0]?.rootHashHex).toBe("string");
	});

	it("rejects expired tokens", async () => {
		const app = makeApp();
		const r = await fetchJson(app, "/v1/admin/bookings", {
			headers: { "x-vsbs-admin-token": EXPIRED_TOKEN },
		});
		expect(r.status).toBe(401);
	});
});

describe("admin router production gate", () => {
	it("refuses sim tokens when appEnv is production", async () => {
		const app = new Hono<AdminAppEnv>();
		app.use("*", async (c, next) => {
			c.set("requestId", "test");
			await next();
		});
		app.route(
			"/v1/admin",
			buildAdminRouter({
				appEnv: "production",
				adminAuthMode: "sim",
				signingKey: SIGN_KEY,
			}),
		);
		const r = await fetchJson(app as unknown as ReturnType<typeof makeApp>, "/v1/admin/bookings", {
			headers: { "x-vsbs-admin-token": ADMIN_TOKEN },
		});
		expect(r.status).toBe(401);
	});
});

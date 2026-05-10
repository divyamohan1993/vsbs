import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { loadEnv } from "../env.js";
import { requestId } from "../middleware/security.js";
import { type SessionAppEnv, signSession } from "../middleware/session.js";
import { MemoryThreadStore, buildConciergeRouter } from "./concierge.js";

const SIGN_KEY = "vsbs-test-session-signing-key-32-bytes-or-more-please";

const TEST_ENV = loadEnv({
	NODE_ENV: "test",
	LLM_PROFILE: "sim",
	SESSION_SIGNING_KEY: SIGN_KEY,
});

async function bearer(subject: string): Promise<string> {
	const s = await signSession({ subject }, { signingKey: SIGN_KEY, defaultTtlSeconds: 3600 });
	return `Bearer ${s.token}`;
}

function buildApp(store?: MemoryThreadStore) {
	const sharedStore = store ?? new MemoryThreadStore();
	const app = new Hono<SessionAppEnv>();
	app.use("*", requestId());
	app.route("/v1/concierge", buildConciergeRouter(TEST_ENV, { store: sharedStore }));
	return { app, store: sharedStore };
}

describe("/v1/concierge — session + thread ownership", () => {
	it("rejects /turn without an Authorization bearer", async () => {
		const { app } = buildApp();
		const res = await app.request("/v1/concierge/turn", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ conversationId: "c-1", userMessage: "hi" }),
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_REQUIRED");
	});

	it("rejects /threads/:id without an Authorization bearer", async () => {
		const { app } = buildApp();
		const res = await app.request("/v1/concierge/threads/c-1");
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("SESSION_REQUIRED");
	});

	it("returns 404 THREAD_NOT_FOUND for an unknown thread", async () => {
		const { app } = buildApp();
		const res = await app.request("/v1/concierge/threads/never-existed", {
			headers: { authorization: await bearer("subject-a") },
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("THREAD_NOT_FOUND");
	});

	it("returns 200 with the messages when the thread is owned by the caller", async () => {
		const store = new MemoryThreadStore();
		store.append("c-mine", "subject-a", [{ role: "user", content: "hello" }]);
		const { app } = buildApp(store);
		const res = await app.request("/v1/concierge/threads/c-mine", {
			headers: { authorization: await bearer("subject-a") },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { id: string; messages: Array<{ role: string; content: string }> };
		};
		expect(body.data.id).toBe("c-mine");
		expect(body.data.messages).toHaveLength(1);
		expect(body.data.messages[0]?.content).toBe("hello");
	});

	it("returns 403 THREAD_FORBIDDEN for /threads/:id when owned by a different subject", async () => {
		const store = new MemoryThreadStore();
		store.append("c-shared", "subject-a", [{ role: "user", content: "secret" }]);
		const { app } = buildApp(store);
		const res = await app.request("/v1/concierge/threads/c-shared", {
			headers: { authorization: await bearer("subject-b") },
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("THREAD_FORBIDDEN");
	});

	it("returns 403 THREAD_FORBIDDEN for /turn against a thread owned by a different subject", async () => {
		const store = new MemoryThreadStore();
		store.append("c-locked", "subject-a", [{ role: "user", content: "first" }]);
		const { app } = buildApp(store);
		const res = await app.request("/v1/concierge/turn", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("subject-b"),
			},
			body: JSON.stringify({
				conversationId: "c-locked",
				userMessage: "intrude",
			}),
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("THREAD_FORBIDDEN");
		// The thread state must remain owned by subject-a and unchanged.
		const stillA = store.get("c-locked", "subject-a");
		expect(stillA).toHaveLength(1);
		expect(stillA?.[0]?.content).toBe("first");
	});

	it("rejects malformed turn bodies with 400 VALIDATION_FAILED", async () => {
		const { app } = buildApp();
		const res = await app.request("/v1/concierge/turn", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: await bearer("subject-a"),
			},
			body: JSON.stringify({ conversationId: "", userMessage: "" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("VALIDATION_FAILED");
	});
});

describe("MemoryThreadStore", () => {
	it("binds a thread to its first owner and rejects other owners", () => {
		const store = new MemoryThreadStore();
		store.append("t", "alice", [{ role: "user", content: "a" }]);
		expect(() => store.append("t", "bob", [{ role: "user", content: "b" }])).toThrow(
			/different subject/i,
		);
		expect(() => store.get("t", "bob")).toThrow(/different subject/i);
		expect(store.get("t", "alice")).toHaveLength(1);
	});

	it("returns undefined for unknown threads", () => {
		const store = new MemoryThreadStore();
		expect(store.get("nope", "anyone")).toBeUndefined();
	});
});

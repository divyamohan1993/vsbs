"use client";

// Offline-first persistence + write queue. Uses IndexedDB directly so
// we ship without a Dexie/Yjs runtime. The schema is small enough that
// the manual code path is easy to audit, and conflict resolution for
// drafts is "last-write-wins keyed on draftId + clientUpdatedAt" which
// matches the API expectation.
//
// Stores:
//   drafts:  intake / booking drafts. Key = draftId.
//   queue:   pending POSTs that failed offline. Auto-played by the
//            service worker through a background sync, or manually by
//            calling `flushQueue()`.
//   meta:    miscellaneous flags (last sync time).
//
// The service worker calls `flushQueue()` on `sync` events and on
// `online` events. We also expose `useOnline()` so React components
// can show staleness banners.

import { useEffect, useState } from "react";

const DB_NAME = "vsbs";
const DB_VERSION = 1;
const STORE_DRAFTS = "drafts";
const STORE_QUEUE = "queue";
const STORE_META = "meta";

interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  attempts: number;
  enqueuedAt: number;
  nextAttemptAt: number;
}

export interface IntakeDraft {
  draftId: string;
  payload: Record<string, unknown>;
  /** Wall-clock millis on the originating client. */
  clientUpdatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment"));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
          db.createObjectStore(STORE_DRAFTS, { keyPath: "draftId" });
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result!: T;
        Promise.resolve(fn(s))
          .then((v) => {
            result = v;
          })
          .catch(reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error("tx aborted"));
      }),
  );
}

function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- Drafts ----

export async function saveDraft(draft: IntakeDraft): Promise<void> {
  await tx(STORE_DRAFTS, "readwrite", async (s) => {
    const existing = (await reqAsync(s.get(draft.draftId))) as IntakeDraft | undefined;
    if (existing && existing.clientUpdatedAt > draft.clientUpdatedAt) {
      // Last-write-wins: a newer local copy already exists, keep it.
      return;
    }
    await reqAsync(s.put(draft));
  });
}

export async function loadDraft(draftId: string): Promise<IntakeDraft | undefined> {
  return tx(STORE_DRAFTS, "readonly", async (s) => (await reqAsync(s.get(draftId))) as IntakeDraft | undefined);
}

export async function listDrafts(): Promise<IntakeDraft[]> {
  return tx(STORE_DRAFTS, "readonly", async (s) => (await reqAsync(s.getAll())) as IntakeDraft[]);
}

export async function deleteDraft(draftId: string): Promise<void> {
  await tx(STORE_DRAFTS, "readwrite", async (s) => {
    await reqAsync(s.delete(draftId));
  });
}

// ---- Queue ----

export async function enqueue(req: Omit<QueuedRequest, "id" | "attempts" | "enqueuedAt" | "nextAttemptAt">): Promise<string> {
  const id = newId();
  const now = Date.now();
  const entry: QueuedRequest = { ...req, id, attempts: 0, enqueuedAt: now, nextAttemptAt: now };
  await tx(STORE_QUEUE, "readwrite", async (s) => {
    await reqAsync(s.put(entry));
  });
  return id;
}

export async function listQueue(): Promise<QueuedRequest[]> {
  return tx(STORE_QUEUE, "readonly", async (s) => (await reqAsync(s.getAll())) as QueuedRequest[]);
}

export async function flushQueue(): Promise<{ ok: number; remaining: number }> {
  const items = await listQueue();
  let ok = 0;
  for (const item of items) {
    if (Date.now() < item.nextAttemptAt) continue;
    try {
      const init: RequestInit = {
        method: item.method,
        headers: item.headers,
      };
      if (item.body !== null) init.body = item.body;
      const res = await fetch(item.url, init);
      if (res.ok) {
        await tx(STORE_QUEUE, "readwrite", async (s) => {
          await reqAsync(s.delete(item.id));
        });
        ok++;
      } else if (res.status >= 400 && res.status < 500) {
        // Permanent failure: drop, do not loop.
        await tx(STORE_QUEUE, "readwrite", async (s) => {
          await reqAsync(s.delete(item.id));
        });
      } else {
        await rescheduleWithBackoff(item);
      }
    } catch {
      await rescheduleWithBackoff(item);
    }
  }
  const remaining = (await listQueue()).length;
  return { ok, remaining };
}

async function rescheduleWithBackoff(item: QueuedRequest): Promise<void> {
  const attempts = item.attempts + 1;
  const delayMs = Math.min(60_000, 1_000 * 2 ** attempts);
  await tx(STORE_QUEUE, "readwrite", async (s) => {
    await reqAsync(
      s.put({ ...item, attempts, nextAttemptAt: Date.now() + delayMs }),
    );
  });
}

export async function fetchOrEnqueue(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (typeof navigator !== "undefined" && navigator.onLine) {
    try {
      const res = await fetch(input, init);
      return res;
    } catch (err) {
      // Fall through to enqueue.
      void err;
    }
  }
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const headers: Record<string, string> = {};
  if (init.headers) {
    const h = new Headers(init.headers);
    h.forEach((v, k) => {
      headers[k] = v;
    });
  }
  const body = typeof init.body === "string" ? init.body : null;
  await enqueue({ url, method: (init.method ?? "GET").toUpperCase(), headers, body });
  return new Response(null, { status: 202, statusText: "Queued offline" });
}

// ---- Meta ----

export async function getMeta(key: string): Promise<unknown> {
  return tx(STORE_META, "readonly", async (s) => {
    const row = (await reqAsync(s.get(key))) as { key: string; value: unknown } | undefined;
    return row?.value;
  });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(STORE_META, "readwrite", async (s) => {
    await reqAsync(s.put({ key, value }));
  });
}

// ---- React helper ----

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const onUp = (): void => setOnline(true);
    const onDown = (): void => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);
  return online;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Service-worker registration helper. Idempotent. Skip in dev if the
// caller does not opt in (the dev server emits unstable bundles that
// are not safe to pin in cache).
export async function registerServiceWorker(opts: { path?: string; scope?: string } = {}): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const path = opts.path ?? "/sw.js";
  const reg = await navigator.serviceWorker.register(path, { scope: opts.scope ?? "/" });
  // When the SW posts a "queue-flushed" message, refresh staleness UI.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (typeof e.data === "object" && e.data && (e.data as { type?: string }).type === "queue-flushed") {
      void setMeta("lastSyncAt", Date.now());
    }
  });
  return reg;
}

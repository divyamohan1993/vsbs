/* VSBS service worker — Phase 8.
 *
 * Strategies (Workbox-aligned semantics, hand-rolled to avoid the
 * runtime cost):
 *   - NetworkFirst for /api/proxy/v1/*  (fresh data wins; cache covers
 *     short outages).
 *   - StaleWhileRevalidate for /_next/static/* and /icons/*.
 *   - CacheFirst for /fonts/*.
 *   - NetworkFirst with /offline fallback for navigation requests.
 *
 * Background sync: on the "sync" event ("vsbs-queue") we replay any
 * queued POSTs that were stashed while offline. The page-side helper
 * also calls `flushQueue()` on `online` events as a belt-and-braces
 * trigger.
 */

const VERSION = "vsbs-sw-2";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const FONT_CACHE = `${VERSION}-fonts`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Same-origin navigation requests get NetworkFirst with offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(navigationStrategy(req));
    return;
  }

  if (url.pathname.startsWith("/api/proxy/")) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  if (url.pathname.startsWith("/fonts/") || /\.(woff2?|ttf|otf)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "vsbs-queue") {
    event.waitUntil(replayQueue());
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "flush-queue") {
    event.waitUntil(replayQueue());
  }
});

// A response is safe to put into a Cache when (a) it's a same-origin basic
// response with a 2xx status and (b) it's not a streaming body the runtime
// will refuse to clone (SSE, opaque, partial). Cache.put on any of those
// throws "encountered a network error" inside the SW, which surfaces as an
// unhandled rejection in the console.
function isCacheable(res) {
  if (!res || res.status === 0 || res.status === 206) return false;
  if (res.type === "opaque" || res.type === "opaqueredirect") return false;
  if (!res.ok) return false;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) return false;
  return true;
}

async function safeCachePut(cache, req, res) {
  if (!isCacheable(res)) return;
  try {
    await cache.put(req, res);
  } catch {
    // Cache.put can still throw on partial bodies, quota exhaustion, or
    // disallowed schemes. Telemetry is fire-and-forget; the live response
    // already went to the page.
  }
}

async function navigationStrategy(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(RUNTIME_CACHE);
    await safeCachePut(cache, req, fresh.clone());
    return fresh;
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    await safeCachePut(cache, req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fresh = fetch(req)
    .then(async (res) => {
      await safeCachePut(cache, req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await fresh) || new Response("", { status: 504 });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  await safeCachePut(cache, req, fresh.clone());
  return fresh;
}

// --- Background queue replay ------------------------------------------------
// We open the same IndexedDB used by src/lib/offline.ts and drain the
// queue store. Any client tabs are notified with a `queue-flushed`
// message so they can refresh staleness banners.

async function replayQueue() {
  let db;
  try {
    db = await openDb();
  } catch {
    return;
  }
  const items = await getAll(db, "queue");
  let replayed = 0;
  for (const item of items) {
    if (Date.now() < item.nextAttemptAt) continue;
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body || undefined,
      });
      if (res.ok) {
        await del(db, "queue", item.id);
        replayed++;
      } else if (res.status >= 400 && res.status < 500) {
        await del(db, "queue", item.id);
      } else {
        await reschedule(db, item);
      }
    } catch (_) {
      await reschedule(db, item);
    }
  }
  const clientsList = await self.clients.matchAll({ type: "window" });
  for (const c of clientsList) c.postMessage({ type: "queue-flushed", replayed });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("vsbs", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "draftId" });
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(db, store) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const s = t.objectStore(store);
    const r = s.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

function del(db, store, key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const s = t.objectStore(store);
    const r = s.delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

function reschedule(db, item) {
  const attempts = (item.attempts || 0) + 1;
  const delayMs = Math.min(60_000, 1_000 * 2 ** attempts);
  return new Promise((resolve, reject) => {
    const t = db.transaction("queue", "readwrite");
    const s = t.objectStore("queue");
    const r = s.put({ ...item, attempts, nextAttemptAt: Date.now() + delayMs });
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

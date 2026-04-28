/* eslint-disable no-restricted-globals */
/**
 * dino-arm-tourney service worker — match-day offline shell.
 *
 * Strategies:
 *   - Precache:           [/offline.html, /brand/logo.jpg, /manifest.webmanifest]
 *   - Navigations (HTML): network-first → cached HTML for same URL → /offline.html
 *   - /_next/static/*:    cache-first (immutable hashed assets)
 *   - /brand/*, fonts:    cache-first
 *   - GET /api/* :        network-first → cached JSON (so re-render of cached
 *                         pages can hydrate)
 *   - POST/PUT/DELETE:    passthrough only. Offline writes are handled by the
 *                         IndexedDB queue in src/lib/sync/queue.ts, not here.
 *
 * Bump CACHE_VERSION when changing fetch strategies or precache list to force
 * a rolling activation (old caches deleted on `activate`).
 */

const CACHE_VERSION = "dino-sw-v3";
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME_HTML = `${CACHE_VERSION}-html`;
const RUNTIME_STATIC = `${CACHE_VERSION}-static`;
const RUNTIME_API = `${CACHE_VERSION}-api`;

const PRECACHE_URLS = [
  "/offline.html",
  "/brand/logo.jpg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // Use addAll but tolerate missing files (don't fail install).
      await Promise.all(
        PRECACHE_URLS.map((u) =>
          cache
            .add(new Request(u, { cache: "reload" }))
            .catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico" ||
    url.pathname.match(/\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|ico|webmanifest)$/i)
  );
}

async function networkFirstHTML(req) {
  const cache = await caches.open(RUNTIME_HTML);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: false });
    if (hit) return hit;
    const offline = await caches.match("/offline.html");
    return (
      offline ||
      new Response("offline", { status: 503, headers: { "content-type": "text/plain" } })
    );
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}

async function networkFirstAPI(req) {
  const cache = await caches.open(RUNTIME_API);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    return new Response(JSON.stringify({ offline: true }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Never touch non-GET — writes go through the IDB queue.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Cross-origin: let the browser handle it (Supabase, R2, fonts CDN).
  if (url.origin !== self.location.origin) return;

  // Next.js dev / HMR endpoints: skip entirely so HMR keeps working.
  if (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/__nextjs_") ||
    url.pathname.startsWith("/_next/data/") // RSC payload, prefer fresh
  ) {
    return;
  }

  // Auth-sensitive / mutation pages: never cache or serve from cache.
  // The state changes (payment verified, weighed in, role granted) MUST
  // re-evaluate guards on every visit. Letting the SW serve a stale 200
  // would expose a form the server has since locked.
  const isAuthSensitive =
    url.pathname.endsWith("/edit") ||
    url.pathname.includes("/edit/") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/auth");
  if (isAuthSensitive) return; // passthrough to network

  if (req.mode === "navigate") {
    event.respondWith(networkFirstHTML(req));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req, RUNTIME_STATIC));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstAPI(req));
    return;
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

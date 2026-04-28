"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js once, after page load. Gated on production by default —
 * the dev server's Turbopack chunks change on every HMR and caching them
 * would break local development. Override with NEXT_PUBLIC_ENABLE_SW=1.
 *
 * No UI. Mount once in a layout.
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const enabled =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_ENABLE_SW === "1";

    if (!enabled) {
      // Dev mode (or SW disabled): proactively unregister any service worker
      // left over from a previous `next start` / production deploy on this
      // origin, and wipe its caches. Otherwise the old SW keeps serving
      // cache-first /_next/static chunks and stale HTML, making fresh code
      // changes invisible until the user manually clears site data.
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => undefined);
      if (typeof caches !== "undefined") {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => undefined);
      }
      return;
    }

    const url = "/sw.js";
    const register = () =>
      navigator.serviceWorker
        .register(url, { scope: "/" })
        .catch((err) => {
          // Non-fatal — SW is a progressive enhancement.
          console.warn("[sw] register failed", err);
        });

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}

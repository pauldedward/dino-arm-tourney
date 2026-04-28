"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Top-of-page route-change progress bar.
 *
 * Next.js App Router server pages don't show a built-in indicator while the
 * next page is being fetched on the server — the user clicks a link and the
 * browser appears frozen until the new HTML streams in. `loading.tsx` files
 * help once a Suspense boundary triggers, but not for instant link clicks.
 *
 * This component bridges that gap: it shows a thin animated bar at the top
 * of the viewport the moment the user clicks an internal link, and hides it
 * once the pathname/search params change (i.e. the new route has rendered).
 *
 * Pure client-side, no deps, brand-colored.
 */
export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hide whenever the route finishes (path or query change settles).
  useEffect(() => {
    setActive(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [pathname, search]);

  // Listen for clicks on internal links / form submissions and start the bar.
  useEffect(() => {
    function isInternalNav(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;
      const anchor = target.closest("a");
      if (!anchor) return false;
      const href = anchor.getAttribute("href");
      if (!href) return false;
      // Skip external, hash-only, mailto/tel, new-tab and download links.
      if (anchor.target === "_blank") return false;
      if (anchor.hasAttribute("download")) return false;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return false;
      }
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return false;
        // Same path + same search = no nav.
        if (url.pathname === window.location.pathname && url.search === window.location.search) {
          return false;
        }
      } catch {
        return false;
      }
      return true;
    }

    function start() {
      // Tiny delay avoids a flash for instant cached navigations, but
      // keep it short so the bar is perceived as immediate feedback.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setActive(true), 40);
    }

    function onClick(e: MouseEvent) {
      // Ignore modified clicks (cmd/ctrl/shift/middle-click open new tab).
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!isInternalNav(e.target)) return;
      start();
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden transition-opacity duration-200 ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="nav-progress-bar h-full w-1/3 bg-rust" />
    </div>
  );
}

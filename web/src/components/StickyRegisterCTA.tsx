"use client";

import { useEffect, useRef, useState } from "react";
import PendingLink from "./PendingLink";

/**
 * Sticky desktop "Register now" pill that appears after the user scrolls past
 * the hero CTA. Lives in the bottom-right corner so the call-to-action is
 * always one click away on long event pages. Hidden on mobile (the page has
 * a separate full-width sticky bar there).
 */
export default function StickyRegisterCTA({
  href,
  label,
  sublabel,
  primary,
  accent,
  onPrimary,
}: {
  href: string;
  label: string;
  sublabel?: string;
  primary: string;
  accent: string;
  onPrimary: string;
}) {
  const [visible, setVisible] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: "0px 0px -60% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      {/* Sentinel placed at top of page; once it scrolls out of view, show pill */}
      <div ref={sentinel} aria-hidden className="absolute left-0 top-[60vh] h-px w-px" />
      <div
        className={`pointer-events-none fixed bottom-6 right-6 z-40 hidden transition-all duration-300 md:block ${
          visible
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0"
        }`}
      >
        <PendingLink
          href={href}
          prefetch
          pendingLabel="Loading…"
          className="pointer-events-auto group flex items-center gap-4 border-2 px-5 py-3 shadow-2xl transition hover:translate-x-[-2px] hover:translate-y-[-2px]"
          style={{ background: accent, color: primary, borderColor: primary }}
        >
          <span
            aria-hidden
            className="relative flex h-2 w-2"
          >
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ background: primary }}
            />
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ background: primary }}
            />
          </span>
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-70">
              Registration open
            </span>
            <span className="font-display text-base font-black uppercase tracking-[0.15em]">
              {label}
            </span>
          </div>
          <span
            aria-hidden
            className="ml-2 text-xl transition group-hover:translate-x-1"
            style={{ color: primary }}
          >
            →
          </span>
        </PendingLink>
        {sublabel && (
          <p
            className="pointer-events-auto mt-1 max-w-[260px] text-right text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{ color: onPrimary, mixBlendMode: "difference" }}
          >
            {sublabel}
          </p>
        )}
      </div>
    </>
  );
}

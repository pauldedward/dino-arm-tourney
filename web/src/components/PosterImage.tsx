"use client";

import { useEffect, useState } from "react";

/**
 * Tap-to-zoom poster viewer. Server page passes the URL + alt; we render a
 * thumb that opens a full-screen overlay on click. Esc / backdrop closes it.
 * Pure client UI — no data fetching, safe to drop into any server component.
 */
export default function PosterImage({
  url,
  alt,
  className,
}: {
  url: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "group relative block w-full overflow-hidden border-2 border-ink bg-bone"
        }
        aria-label="Open full-size poster"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="block h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
        <span className="pointer-events-none absolute bottom-2 right-2 bg-ink/80 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.25em] text-bone opacity-0 transition group-hover:opacity-100">
          Tap to zoom
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Event poster"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/95 p-3 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            aria-label="Close poster"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 z-[61] border border-bone/40 bg-ink/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-bone hover:bg-ink"
          >
            Close ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            className="max-h-[92vh] max-w-full object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

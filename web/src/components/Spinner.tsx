/**
 * Brand-aligned loading indicator.
 *
 * Variants:
 *  - `inline`  — small spinner for use inside buttons / form rows / chips.
 *                Renders as `inline-flex` with stable line-height so swapping
 *                text → spinner does not push neighbours around.
 *  - `screen`  — full-section block with caption, used by route-segment
 *                `loading.tsx` files during navigation + lazy data loads.
 *  - `card`    — same caption styling but no min-height; good for in-page
 *                panel placeholders.
 *
 * Visual: dual-arc SVG ring drawn in `currentColor` (defaults to rust),
 * paired with a mono uppercase caption that ticks an animated `…` so the
 * UI feels alive even on slow networks. Honours `prefers-reduced-motion`
 * via the `.loader-ring` / `.loader-dots` rules in globals.css.
 */
import type { CSSProperties } from "react";

type Props = {
  variant?: "inline" | "screen" | "card";
  /** Caption text. Defaults to "Loading". */
  label?: string;
  /** Hide the caption visually (still announced to screen readers). */
  hideLabel?: boolean;
  /** Tailwind size classes for the inline ring (default `h-3.5 w-3.5`). */
  size?: string;
  /** Extra classes on the outer wrapper. */
  className?: string;
  style?: CSSProperties;
};

export default function Spinner({
  variant = "inline",
  label = "Loading",
  hideLabel = false,
  size,
  className = "",
  style,
}: Props) {
  if (variant === "screen" || variant === "card") {
    const wrapperBase =
      variant === "screen"
        ? "flex min-h-[40vh] w-full items-center justify-center px-6 py-10"
        : "flex w-full items-center justify-center py-8";
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className={`${wrapperBase} ${className}`}
        style={style}
      >
        <div className="flex flex-col items-center gap-3 text-rust">
          <Ring className="h-9 w-9" />
          {!hideLabel && (
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink/55">
              {label}
              <span className="loader-dots" aria-hidden />
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`inline-flex items-center gap-1.5 align-middle leading-none text-rust ${className}`}
      style={style}
    >
      <Ring className={size ?? "h-3.5 w-3.5"} />
      {!hideLabel && (
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/55">
          {label}
          <span className="loader-dots" aria-hidden />
        </span>
      )}
    </span>
  );
}

/**
 * Dual-arc ring rendered in SVG so the stroke stays crisp at any size and
 * inherits `currentColor`. A faint full circle plus a 270° arc gives a
 * smoother, more deliberate spin than the Tailwind border-trick spinner.
 */
function Ring({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`loader-ring ${className}`}
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="2.5"
      />
      <path
        d="M21 12 a9 9 0 0 0 -9 -9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

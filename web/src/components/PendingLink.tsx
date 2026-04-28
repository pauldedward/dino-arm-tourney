"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  forwardRef,
  useTransition,
  type AnchorHTMLAttributes,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

/**
 * Drop-in replacement for `next/link` that gives the user instant click
 * feedback during App Router server navigations.
 *
 * Why: `loading.tsx` Suspense boundaries only show once the network round
 * trip starts streaming, and `NavProgress` (the top bar) is intentionally
 * subtle. Big call-to-action buttons need a more obvious "I heard you"
 * affordance — otherwise the page appears frozen for 200-1500 ms while
 * the RSC payload is fetched.
 *
 * Implementation: hijack the click, call `router.push` inside
 * `useTransition`, and render `pendingChildren` (defaults to a small
 * spinner) while the transition is pending. The transition flips back to
 * idle once React has committed the new route, so a single component does
 * its own pending/settled state — no global store, no `usePathname`
 * gymnastics.
 *
 * Modified clicks (cmd/ctrl/shift/middle-click), `target=_blank`, and
 * `download` links fall back to native browser behaviour so right-click
 * "open in new tab" still works.
 */
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  prefetch?: boolean;
  /**
   * Content shown while the navigation is in flight. Defaults to a brand
   * spinner appended to `children`. Pass `null` to hide children entirely
   * and only show a spinner.
   */
  pendingLabel?: ReactNode;
  /** Render the spinner before instead of after the children. */
  spinnerSide?: "left" | "right";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

const PendingLink = forwardRef<HTMLAnchorElement, Props>(function PendingLink(
  {
    href,
    prefetch,
    pendingLabel,
    spinnerSide = "right",
    onClick,
    className,
    style,
    children,
    ...rest
  },
  ref
) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target === "_blank") return;
    // Same-origin only; let browser handle anything weird.
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
    } catch {
      return;
    }
    e.preventDefault();
    startTransition(() => {
      router.push(href);
    });
  }

  const spinner = (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      className="loader-ring h-3.5 w-3.5 shrink-0"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
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

  /*
   * Stack children + spinner in the same grid cell so the link's intrinsic
   * width/height never changes when toggling pending state. The children
   * stay laid out (just hidden) which preserves the button's footprint;
   * the spinner overlays them centered. Eliminates the layout shift that
   * the old `pendingLabel` text-swap caused.
   *
   * `pendingLabel` is kept as the accessible busy announcement only.
   */
  void spinnerSide;
  const content = (
    <span className="relative inline-grid">
      <span
        className={`col-start-1 row-start-1 inline-flex items-center gap-2 transition-opacity duration-150 ${
          isPending ? "invisible opacity-0" : "opacity-100"
        }`}
      >
        {children}
      </span>
      {isPending && (
        <span
          aria-label={
            typeof pendingLabel === "string" ? pendingLabel : "Loading"
          }
          className="col-start-1 row-start-1 flex items-center justify-center"
        >
          {spinner}
        </span>
      )}
    </span>
  );

  return (
    <Link
      ref={ref}
      href={href}
      prefetch={prefetch}
      onClick={handleClick}
      aria-busy={isPending || undefined}
      data-pending={isPending ? "" : undefined}
      className={[className, isPending ? "cursor-wait opacity-80" : ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
      {...rest}
    >
      {content}
    </Link>
  );
});

export default PendingLink;

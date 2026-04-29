"use client";

/**
 * Reusable pagination footer for admin tables.
 *
 * Two flavours:
 *  - Controlled (client/SPA tables): pass `page`, `onPage`, `pageSize`,
 *    `onPageSize`. Buttons call the handlers.
 *  - Link-mode (RSC/server tables): pass `linkBase = { path, params }`.
 *    The component builds `?page=` / `?pageSize=` URLs itself so server
 *    components don't have to ship a function across the RSC boundary
 *    (which Next.js refuses to serialize).
 *
 * UI mirrors `FastRegistrationsTable` so the operator console feels
 * uniform: First / ← / next → / Last + jump-to + Per page selector.
 */

import Link from "next/link";

const DEFAULT_OPTIONS = [25, 50, 100, 200, 500] as const;

export interface PaginationLinkBase {
  /** Pathname to link to, e.g. `/admin/audit`. */
  path: string;
  /** Existing query params to preserve. Falsy values are dropped. */
  params?: Record<string, string | undefined>;
  /** Param name used for the page number. Defaults to `page`. */
  pageParam?: string;
  /** Param name used for the per-page size. Defaults to `pageSize`. */
  pageSizeParam?: string;
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Optional override of the per-page menu. */
  options?: readonly number[];
  /** Loading state disables the buttons. */
  loading?: boolean;
  /** Short label e.g. "rows", "events", "users". Shown in the count. */
  itemLabel?: string;
  /** Controlled mode handlers. */
  onPage?: (p: number) => void;
  onPageSize?: (n: number) => void;
  /** Link mode (server pages). All values must be JSON-serializable. */
  linkBase?: PaginationLinkBase;
  /** Compact mode hides the per-page selector + jump field. */
  compact?: boolean;
  className?: string;
}

function buildHref(base: PaginationLinkBase, overrides: Record<string, string>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(base.params ?? {})) {
    if (typeof v === "string" && v) next.set(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v == null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return `${base.path}${qs ? `?${qs}` : ""}`;
}

export default function Pagination({
  page,
  pageSize,
  total,
  options = DEFAULT_OPTIONS,
  loading = false,
  itemLabel = "rows",
  onPage,
  onPageSize,
  linkBase,
  compact = false,
  className = "",
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(total, safePage * pageSize);

  const goPrev = safePage - 1;
  const goNext = safePage + 1;
  const pageParam = linkBase?.pageParam ?? "page";
  const pageSizeParam = linkBase?.pageSizeParam ?? "pageSize";
  const hrefForPage = (p: number): string | undefined =>
    linkBase ? buildHref(linkBase, { [pageParam]: String(p) }) : undefined;
  const hrefForPageSize = (n: number): string | undefined =>
    linkBase
      ? buildHref(linkBase, {
          [pageSizeParam]: String(n),
          [pageParam]: "1",
        })
      : undefined;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-bone px-3 py-2 font-mono text-[13px] ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-ink/70">
          {total === 0 ? (
            <>No {itemLabel}</>
          ) : (
            <>
              <span className="font-bold tabular-nums">{from.toLocaleString()}</span>
              –
              <span className="font-bold tabular-nums">{to.toLocaleString()}</span>{" "}
              of <span className="font-bold tabular-nums">{total.toLocaleString()}</span>{" "}
              {itemLabel}
            </>
          )}
        </span>
        <span className="text-ink/40">·</span>
        <span className="text-ink/70">
          Page <span className="font-bold tabular-nums">{safePage}</span> /{" "}
          <span className="tabular-nums">{totalPages}</span>
        </span>
        {!compact && totalPages > 5 && (
          <label className="flex items-center gap-1 text-ink/60">
            <span className="uppercase tracking-[0.2em]">Go to</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              defaultValue={safePage}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = Math.max(
                  1,
                  Math.min(totalPages, Number((e.target as HTMLInputElement).value) || 1)
                );
                if (onPage) onPage(v);
                else {
                  const url = hrefForPage(v);
                  if (url) window.location.href = url;
                }
              }}
              className="w-14 border border-ink bg-bone px-1 py-0.5 text-center font-mono text-[13px]"
              aria-label="Jump to page"
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!compact && onPageSize && (
          <label className="flex items-center gap-1">
            <span className="uppercase tracking-[0.2em] text-ink/50">Per page</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              disabled={loading}
              className="border border-ink bg-bone px-2 py-1 font-mono text-[13px] disabled:opacity-50"
            >
              {options.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {!compact && linkBase && !onPageSize && (
          <label className="flex items-center gap-1">
            <span className="uppercase tracking-[0.2em] text-ink/50">Per page</span>
            <select
              defaultValue={pageSize}
              onChange={(e) => {
                const url = hrefForPageSize(Number(e.target.value));
                if (url) window.location.href = url;
              }}
              className="border border-ink bg-bone px-2 py-1 font-mono text-[13px]"
            >
              {options.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <NavBtn
          label="« first"
          disabled={safePage <= 1 || loading}
          onClick={onPage ? () => onPage(1) : undefined}
          href={hrefForPage(1)}
        />
        <NavBtn
          label="← prev"
          disabled={safePage <= 1 || loading}
          onClick={onPage ? () => onPage(goPrev) : undefined}
          href={hrefForPage(goPrev)}
        />
        <NavBtn
          label="next →"
          disabled={safePage >= totalPages || loading}
          onClick={onPage ? () => onPage(goNext) : undefined}
          href={hrefForPage(goNext)}
        />
        <NavBtn
          label="last »"
          disabled={safePage >= totalPages || loading}
          onClick={onPage ? () => onPage(totalPages) : undefined}
          href={hrefForPage(totalPages)}
        />
      </div>
    </div>
  );
}

function NavBtn({
  label,
  disabled,
  onClick,
  href,
}: {
  label: string;
  disabled: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const cls =
    "border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30 hover:bg-ink hover:text-bone disabled:hover:bg-bone disabled:hover:text-ink";
  if (href && !disabled) {
    return (
      <Link href={href} prefetch={false} className={cls}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cls}>
      {label}
    </button>
  );
}

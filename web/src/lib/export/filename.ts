/**
 * Shared filename helpers for downloadable exports (PDF, XLSX, CSV, ZIP).
 *
 * Goals:
 *   - Human-meaningful names (event slug + sheet kind + date),
 *     never a raw UUID slice like `nominal-2000000a.pdf`.
 *   - Stable, lowercase, kebab-case so they survive Windows/Mac/Linux.
 *   - Safe to drop into a `Content-Disposition: attachment; filename="…"`
 *     header without quoting issues.
 *
 * Audit-log keys (`action` strings, `target_table`, etc.) live elsewhere
 * and are intentionally NOT touched by these helpers.
 */

/** Convert any free-text label to a filename-safe slug. */
export function slugify(input: string | null | undefined): string {
  const s = (input ?? "")
    .toString()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "event";
}

/** YYYY-MM-DD in UTC; matches the date stamps used elsewhere in the app. */
export function todayStamp(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build a meaningful download filename.
 *
 *   exportFilename({ eventSlug: "tn-state-2026", kind: "nominal", ext: "pdf" })
 *     => "tn-state-2026-nominal-2026-04-27.pdf"
 *
 *   exportFilename({ eventName: "TN State 2026", kind: "category",
 *                    suffix: "M-S-78", ext: "csv" })
 *     => "tn-state-2026-category-m-s-78-2026-04-27.csv"
 *
 * Order of preference for the event segment: `eventSlug` (already a slug
 * in the DB), then `slugify(eventName)`. If neither is provided the event
 * segment is dropped so the file is still meaningful (e.g. `audit-log-…`).
 */
export function exportFilename(parts: {
  eventSlug?: string | null;
  eventName?: string | null;
  kind: string;
  /** Extra qualifier (category code, district name, etc.). Optional. */
  suffix?: string | null;
  /** Extension WITHOUT the leading dot. */
  ext: string;
  /** Override the date (used by tests). */
  date?: Date;
  /** Set false to skip the date stamp (rare; used for per-athlete files). */
  includeDate?: boolean;
}): string {
  const eventPart =
    (parts.eventSlug && slugify(parts.eventSlug)) ||
    (parts.eventName ? slugify(parts.eventName) : "");

  const segments = [
    eventPart,
    slugify(parts.kind),
    parts.suffix ? slugify(parts.suffix) : "",
    parts.includeDate === false ? "" : todayStamp(parts.date),
  ].filter(Boolean);

  const ext = parts.ext.replace(/^\.+/, "").toLowerCase() || "bin";
  return `${segments.join("-")}.${ext}`;
}

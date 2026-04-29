"use client";

/**
 * Per-section export controls used inside the dark category banner on
 * the Category Sheet and Fixtures preview pages.
 *
 * - CSV download: client-side, builds a minimal RFC 4180 CSV from the
 *   rows the parent server component already rendered. No new API.
 * - Print: hides every other `[data-category-section]` on the page,
 *   triggers `window.print()`, and restores layout on `afterprint`.
 *
 * IMPORTANT: data is passed pre-flattened (headers: string[], rows:
 * string[][]) so we don't ship function accessors across the
 * server/client boundary — RSC cannot serialize functions and that
 * causes the whole page to fail to render.
 */

import { useCallback } from "react";

export default function CategorySectionActions({
  filename,
  headers,
  rows,
  sectionId,
}: {
  filename: string;
  headers: string[];
  rows: string[][];
  /** Stable id placed on the wrapper via `data-category-section`. */
  sectionId: string;
}) {
  const onCsv = useCallback(() => {
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [headers, rows, filename]);

  const onPrint = useCallback(() => {
    const all = document.querySelectorAll<HTMLElement>(
      "[data-category-section]"
    );
    const hidden: HTMLElement[] = [];
    all.forEach((el) => {
      if (el.dataset.categorySection !== sectionId) {
        hidden.push(el);
        el.style.display = "none";
      }
    });
    const restore = () => {
      hidden.forEach((el) => {
        el.style.display = "";
      });
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    // Safety net: some browsers don't fire afterprint reliably.
    setTimeout(restore, 2000);
  }, [sectionId]);

  return (
    <div className="flex items-center gap-1 print:hidden">
      <button
        type="button"
        onClick={onCsv}
        title="Download this category as CSV"
        className="border border-paper/40 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.15em] text-paper/90 hover:bg-paper hover:text-ink"
      >
        CSV ↓
      </button>
      <button
        type="button"
        onClick={onPrint}
        title="Print only this category"
        className="border border-paper/40 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.15em] text-paper/90 hover:bg-paper hover:text-ink"
      >
        Print ⎙
      </button>
    </div>
  );
}

function toCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string): string =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const head = headers.map(esc).join(",");
  const body = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  return `${head}\r\n${body}\r\n`;
}

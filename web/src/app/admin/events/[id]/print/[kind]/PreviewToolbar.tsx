"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { formatCategoryCode } from "@/lib/rules/category-label";

export default function PreviewToolbar({
  pdfUrl,
  xlsxUrl,
  divisions,
  categories,
  totalLabel,
  zipUrl,
}: {
  pdfUrl?: string;
  xlsxUrl?: string;
  divisions?: string[];
  categories?: string[];
  totalLabel: string;
  zipUrl?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const q = sp.get("q") ?? "";
  const division = sp.get("division") ?? "";
  const category = sp.get("category") ?? "";

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Filter changes always invalidate the current page — jump back to
    // page 1 so the operator never sees an "empty page 4" after a search.
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function printNow() {
    if (pdfUrl) window.open(pdfUrl, "_blank", "noopener");
  }

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b-2 border-ink bg-paper/95 px-4 py-3 backdrop-blur print:hidden">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
        <input
          type="search"
          defaultValue={q}
          placeholder="search name / chest / district…"
          onChange={(e) => update({ q: e.currentTarget.value })}
          className="min-w-[220px] flex-1 border-2 border-ink bg-paper px-2 py-1.5"
        />
        {divisions && divisions.length > 0 && (
          <select
            value={division}
            onChange={(e) => update({ division: e.currentTarget.value })}
            className="border-2 border-ink bg-paper px-2 py-1.5"
          >
            <option value="">all divisions</option>
            {divisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        {categories && categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => update({ category: e.currentTarget.value })}
            className="border-2 border-ink bg-paper px-2 py-1.5"
          >
            <option value="">all categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {formatCategoryCode(c)} ({c})
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-[12px] uppercase tracking-[0.2em] text-ink/60">
          {pending ? "filtering…" : totalLabel}
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          className="border-2 border-ink px-3 py-1.5 hover:bg-kraft/30"
          title="Print this on-screen view"
        >
          Print view ⎙
        </button>
        {pdfUrl && (
          <button
            type="button"
            onClick={printNow}
            className="border-2 border-ink bg-volt px-3 py-1.5 hover:bg-rust hover:text-paper"
            title="Open the official branded PDF"
          >
            Open PDF ↗
          </button>
        )}
        {xlsxUrl && (
          <a
            href={xlsxUrl}
            className="border-2 border-ink bg-paper px-3 py-1.5 hover:bg-kraft/30"
            title="Download styled XLSX of this sheet"
          >
            XLSX ↓
          </a>
        )}
        {zipUrl && (
          <a
            href={zipUrl}
            className="border-2 border-ink bg-paper px-3 py-1.5 hover:bg-kraft/30"
            title="Download a ZIP with one XLSX per district and one per team"
          >
            XLSX zip ↓
          </a>
        )}
      </div>
    </div>
  );
}

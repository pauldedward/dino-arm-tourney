"use client";

import { useMemo, useState } from "react";

export type IdCardRow = {
  id: string;
  chest_no: number | null;
  full_name: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  photo_url: string | null;
};

/**
 * Selectable ID card preview grid. Each card has a checkbox so operators
 * can re-print a single (or arbitrary subset of) lost/damaged cards
 * without spitting out the whole 9-up sheet. The "Print selected" button
 * just opens the same `/api/pdf/id-cards` route with an `ids=` filter.
 */
export default function IdCardsGrid({
  eventId,
  rows,
}: {
  eventId: string;
  rows: IdCardRow[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const noneSelected = selected.size === 0;

  const printUrl = useMemo(() => {
    const ids = Array.from(selected);
    if (ids.length === 0) return null;
    return `/api/pdf/id-cards?event=${eventId}&ids=${ids.join(",")}`;
  }, [selected, eventId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(rows.map((r) => r.id)));
  }

  function clear() {
    setSelected(new Set());
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 border-2 border-ink bg-kraft/20 px-3 py-2 font-mono text-[13px] print:hidden">
        <span className="uppercase tracking-[0.2em] text-ink/70">
          {selected.size} selected
        </span>
        <button
          type="button"
          onClick={selectAll}
          disabled={allSelected}
          className="border-2 border-ink bg-paper px-2 py-1 hover:bg-kraft/30 disabled:opacity-40"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={noneSelected}
          className="border-2 border-ink bg-paper px-2 py-1 hover:bg-kraft/30 disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => printUrl && window.open(printUrl, "_blank", "noopener")}
          disabled={!printUrl}
          className="ml-auto border-2 border-ink bg-volt px-3 py-1 hover:bg-rust hover:text-paper disabled:opacity-40 disabled:hover:bg-volt disabled:hover:text-ink"
          title="Open a PDF with only the selected cards"
        >
          Print selected ↗
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {rows.map((r) => {
          const isSel = selected.has(r.id);
          return (
            <label
              key={r.id}
              className={`relative cursor-pointer border-2 bg-paper p-3 transition-colors ${
                isSel ? "border-rust ring-2 ring-rust/30" : "border-ink"
              }`}
            >
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => toggle(r.id)}
                className="absolute right-2 top-2 h-4 w-4 accent-rust print:hidden"
              />
              <div className="flex items-start justify-between pr-6">
                <p className="font-display text-3xl font-black leading-none">
                  {r.chest_no ?? "—"}
                </p>
                {r.photo_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={r.photo_url}
                    alt=""
                    className="h-12 w-12 border border-ink object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 border border-dashed border-ink/40" />
                )}
              </div>
              <p className="mt-2 truncate font-mono text-[13px] font-bold">
                {r.full_name}
              </p>
              <p className="font-mono text-[12px] text-ink/60">
                {r.division ?? "—"} · {r.declared_weight_kg ?? "—"}kg
              </p>
              <p className="font-mono text-[12px] text-ink/60">
                {r.district ?? "—"}
              </p>
            </label>
          );
        })}
        {rows.length === 0 && (
          <p className="col-span-full border-2 border-dashed border-ink/30 p-6 text-center font-mono text-[13px] text-ink/50">
            No matching athletes.
          </p>
        )}
      </div>
    </>
  );
}

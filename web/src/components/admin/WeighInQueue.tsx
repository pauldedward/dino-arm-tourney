"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PendingLink from "@/components/PendingLink";
import { isPaid } from "@/lib/payments/status";

export type WeighInRow = {
  id: string;
  chest_no: number | null;
  full_name: string | null;
  initial: string | null;
  division: string | null;
  district: string | null;
  declared_weight_kg: number | null;
  weight_class_code: string | null;
  status?: string | null;
  checkin_status?: "not_arrived" | "weighed_in" | "no_show" | null;
  weigh_ins:
    | { id: string; measured_kg: number | null; weighed_at: string | null }[]
    | null;
  payments:
    | { id: string; status: string | null; amount_inr: number | null }[]
    | null;
};

interface Props {
  rows: WeighInRow[];
  eventSlug: string;
}

/**
 * Fast weigh-in queue: client-side instant search across name / chest_no /
 * district, j/k keyboard navigation, Enter → capture page, auto-refresh on
 * focus + every 20s. Pending rows pinned above completed rows.
 */
export default function WeighInQueue({ rows, eventSlug }: Props) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [doneOpen, setDoneOpen] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);

  const { pending, done, noShow } = useMemo(() => {
    const lower = q.trim().toLowerCase();
    const filt = (r: WeighInRow) => {
      if (!lower) return true;
      const fields = [
        r.full_name ?? "",
        r.initial ?? "",
        String(r.chest_no ?? ""),
        r.district ?? "",
        r.division ?? "",
        r.weight_class_code ?? "",
      ];
      return fields.some((f) => f.toLowerCase().includes(lower));
    };
    const p: WeighInRow[] = [];
    const d: WeighInRow[] = [];
    const ns: WeighInRow[] = [];
    for (const r of rows) {
      if (!filt(r)) continue;
      const ws = Array.isArray(r.weigh_ins) ? r.weigh_ins : [];
      if (r.checkin_status === "no_show") ns.push(r);
      else if (ws.length === 0) p.push(r);
      else d.push(r);
    }
    return { pending: p, done: d, noShow: ns };
  }, [rows, q]);

  // Combined nav order: pending first, then done, then no-show.
  const navOrder = useMemo(
    () => [...pending, ...done, ...noShow],
    [pending, done, noShow]
  );

  useEffect(() => {
    if (cursor >= navOrder.length) setCursor(Math.max(0, navOrder.length - 1));
  }, [navOrder.length, cursor]);

  // Periodic revalidation of underlying server data without a full nav.
  useEffect(() => {
    function refresh() {
      // soft-refresh: re-request the page so RSC re-renders rows.
      // We rely on Next's router.refresh() via a global listener if mounted.
      // For simplicity force a same-URL reload in the background only when
      // the user is idle (no input focused).
      const inField =
        document.activeElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (document.activeElement as HTMLElement).tagName
        );
      if (!inField) location.reload();
    }
    const onFocus = () => refresh();
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inField =
        t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      if (e.key === "/" && !inField) {
        e.preventDefault();
        document.getElementById("weighin-search-input")?.focus();
        return;
      }
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (inField) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(navOrder.length - 1, c + 1));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (e.key === "Enter") {
        const r = navOrder[cursor];
        if (r) location.href = `/admin/events/${eventSlug}/weighin/${r.id}`;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOrder, cursor, eventSlug]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 border-2 border-ink p-3">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Search
          </span>
          <input
            id="weighin-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name / chest # / district / class"
            autoFocus
            className="mt-1 block w-80 border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          />
        </label>
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="h-10 border-2 border-ink/30 px-3 font-mono text-[10px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Clear
          </button>
        )}
        <p className="ml-auto font-mono text-[10px] text-ink/50">
          <kbd className="border border-ink/40 px-1">/</kbd> search ·{" "}
          <kbd className="border border-ink/40 px-1">j/k</kbd> move ·{" "}
          <kbd className="border border-ink/40 px-1">Enter</kbd> capture
        </p>
      </div>

      <Section
        title="Pending"
        count={pending.length}
        rows={pending}
        eventSlug={eventSlug}
        state="pending"
        cursor={cursor}
        offset={0}
        onHover={setCursor}
        open={pendingOpen}
        onToggle={() => setPendingOpen((v) => !v)}
      />
      <Section
        title="Weighed in"
        count={done.length}
        rows={done}
        eventSlug={eventSlug}
        state="done"
        cursor={cursor}
        offset={pending.length}
        onHover={setCursor}
        open={doneOpen}
        onToggle={() => setDoneOpen((v) => !v)}
      />
      {noShow.length > 0 && (
        <Section
          title="No-show"
          count={noShow.length}
          rows={noShow}
          eventSlug={eventSlug}
          state="done"
          cursor={cursor}
          offset={pending.length + done.length}
          onHover={setCursor}
          open={noShowOpen}
          onToggle={() => setNoShowOpen((v) => !v)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  count,
  rows,
  eventSlug,
  state,
  cursor,
  offset,
  onHover,
  open,
  onToggle,
}: {
  title: string;
  count: number;
  rows: WeighInRow[];
  eventSlug: string;
  state: "pending" | "done";
  cursor: number;
  offset: number;
  onHover: (i: number) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-ink/70 hover:text-ink"
      >
        <span aria-hidden className="inline-block w-3 text-ink/50">
          {open ? "▾" : "▸"}
        </span>
        <span>
          {title} · <span className="tabular-nums">{count}</span>
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto border-2 border-ink">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink bg-kraft/20 text-left font-mono text-[10px] uppercase tracking-[0.2em]">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Division</th>
              <th className="px-3 py-3">District</th>
              <th className="px-3 py-3">Payment</th>
              <th className="px-3 py-3 text-right">Declared</th>
              <th className="px-3 py-3 text-right">
                {state === "done" ? "Measured" : "Class"}
              </th>
              <th className="px-3 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const wi = r.weigh_ins?.[0];
              const isCur = offset + i === cursor;
              const pay = paymentSummary(r);
              return (
                <tr
                  key={r.id}
                  onMouseEnter={() => onHover(offset + i)}
                  className={`border-b border-ink/10 last:border-b-0 ${
                    isCur ? "bg-kraft/40" : "hover:bg-kraft/10"
                  }`}
                >
                  <td className="px-3 py-2 font-mono tabular-nums text-ink/60">
                    {r.chest_no ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    {r.initial ? `${r.initial}. ` : ""}
                    {r.full_name ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.division ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink/70">
                    {r.district ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] ${pay.cls}`}
                    >
                      {pay.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.declared_weight_kg ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {state === "done"
                      ? wi?.measured_kg ?? "—"
                      : r.weight_class_code ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <PendingLink
                      href={`/admin/events/${eventSlug}/weighin/${r.id}`}
                      prefetch
                      pendingLabel="Loading…"
                      className="border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-ink hover:text-bone"
                    >
                      {state === "done" ? "Re-weigh" : "Capture →"}
                    </PendingLink>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center font-mono text-xs text-ink/50"
                >
                  {state === "pending" ? "Nothing pending." : "No captures yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

function paymentSummary(r: WeighInRow): { label: string; cls: string } {
  // Single source of truth: isPaid() collapses payments[].status === 'verified'
  // and the legacy registrations.status flags into one answer so the operator
  // never sees a row that disagrees with the rest of the console.
  const ps = Array.isArray(r.payments) ? r.payments : [];
  const rejected = ps.some((p) => p?.status === "rejected");
  if (isPaid(r.status, ps)) {
    return { label: "Paid", cls: "border-moss/60 bg-moss/10 text-moss" };
  }
  if (rejected) {
    return {
      label: "Rejected",
      cls: "border-rust/60 bg-rust/10 text-rust",
    };
  }
  if (ps.length > 0) {
    return {
      label: "Pending",
      cls: "border-rust/60 bg-rust/10 text-rust",
    };
  }
  return {
    label: "Unpaid",
    cls: "border-rust/60 bg-rust/10 text-rust",
  };
}

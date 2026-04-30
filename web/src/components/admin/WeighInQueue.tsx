"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PendingLink from "@/components/PendingLink";
import ClassesCell from "@/components/admin/ClassesCell";
import { buildOverrideRows } from "@/lib/rules/weight-overrides";
import type { WeightOverride } from "@/lib/rules/resolve";

export type WeighInRow = {
  id: string;
  chest_no: number | null;
  full_name: string | null;
  initial: string | null;
  dob: string | null;
  district: string | null;
  declared_weight_kg: number | null;
  weight_class_code: string | null;
  gender?: "M" | "F" | null;
  nonpara_classes?: string[] | null;
  nonpara_hands?: Array<"R" | "L" | "B" | null> | null;
  nonpara_hand?: "R" | "L" | "B" | null;
  para_codes?: string[] | null;
  para_hand?: "R" | "L" | "B" | null;
  weight_overrides?: WeightOverride[] | null;
  status?: string | null;
  lifecycle_status?: "active" | "withdrawn" | null;
  discipline_status?: "clear" | "disqualified" | null;
  checkin_status?: "not_arrived" | "weighed_in" | "no_show" | null;
  weigh_ins:
    | { id: string; measured_kg: number | null; weighed_at: string | null }[]
    | null;
};

interface Props {
  rows: WeighInRow[];
  eventSlug: string;
}

/**
 * Fast weigh-in queue: client-side instant search across name / chest_no /
 * district, j/k keyboard navigation, Enter → focus the row's inline
 * weight input, auto-refresh on focus + every 60s. Pending rows pinned
 * above completed rows.
 *
 * The primary action is now an inline weight + Save button on every row
 * so floor staff can rip through the queue without leaving the table.
 * The full photo-capture flow stays available as a secondary "Photo →"
 * link for athletes who need scale-proof imagery.
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
        r.dob ?? "",
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
        if (r) {
          const el = document.getElementById(`weighin-kg-${r.id}`);
          (el as HTMLInputElement | null)?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOrder, cursor]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 border-2 border-ink p-3">
        <label className="block">
          <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
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
            className="h-10 border-2 border-ink/30 px-3 font-mono text-[12px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Clear
          </button>
        )}
        <p className="ml-auto font-mono text-[12px] text-ink/50">
          <kbd className="border border-ink/40 px-1">/</kbd> search ·{" "}
          <kbd className="border border-ink/40 px-1">j/k</kbd> move ·{" "}
          <kbd className="border border-ink/40 px-1">Enter</kbd> focus weight
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
  const PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const visible = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const showPager = rows.length > 25;

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.3em] text-ink/70 hover:text-ink"
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
            <thead className="border-b-2 border-ink bg-kraft/20 text-left font-mono text-[12px] uppercase tracking-[0.2em]">
              <tr>
                <th className="px-3 py-3">Chest</th>
                <th className="px-3 py-3">Athlete</th>
                <th className="px-3 py-3">Date of birth</th>
                <th className="px-3 py-3">District</th>
                <th className="px-3 py-3 text-right">Declared kg</th>
                <th className="px-3 py-3">Division & class</th>
                <th className="px-3 py-3">
                  {state === "done" ? "Measured kg" : "Record weight"}
                </th>
                <th className="px-3 py-3 text-right">Proof photo</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const wi = r.weigh_ins?.[0];
                const realIndex = (safePage - 1) * pageSize + i;
                const isCur = offset + realIndex === cursor;
                return (
                  <tr
                    key={r.id}
                    onMouseEnter={() => onHover(offset + realIndex)}
                    className={`border-b border-ink/10 last:border-b-0 ${
                      isCur ? "bg-kraft/40" : "hover:bg-kraft/10"
                    }`}
                  >
                    <td className="px-3 py-2 align-top font-mono tabular-nums text-ink/60">
                      {r.chest_no ?? "—"}
                    </td>
                    <td className="px-3 py-2 align-top font-semibold">
                      {r.initial ? `${r.initial}. ` : ""}
                      {r.full_name ?? "—"}
                    </td>
                    <td className="px-3 py-2 align-top font-mono tabular-nums text-[13px]">
                      {formatDob(r.dob)}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-[13px] text-ink/70">
                      {r.district ?? "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono tabular-nums">
                      {r.declared_weight_kg ?? "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {/*
                        Once a measured weight exists, show the resolved
                        bucket against the actual scale reading — that
                        is the bracket the athlete will compete in. The
                        declared kg is only a fallback for pending rows.
                      */}
                      <ClassesCell
                        row={{
                          ...r,
                          declared_weight_kg:
                            wi?.measured_kg ?? r.declared_weight_kg,
                        }}
                      />
                      {bucketChanged(r, wi?.measured_kg ?? null) && (
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-rust">
                          bracket changed · measured {wi!.measured_kg} kg · was
                          declared {r.declared_weight_kg} kg
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <QuickWeighIn row={r} measured={wi?.measured_kg ?? null} />
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <PendingLink
                        href={`/admin/events/${eventSlug}/weighin/${r.id}`}
                        prefetch
                        pendingLabel="…"
                        className="border border-ink/40 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.2em] hover:border-ink hover:bg-ink hover:text-bone"
                      >
                        Photo →
                      </PendingLink>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center font-mono text-[13px] text-ink/50"
                  >
                    {state === "pending"
                      ? "Nothing pending."
                      : "No captures yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {open && showPager && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-ink bg-bone px-3 py-2 font-mono text-[13px]">
          <div className="flex items-center gap-3 text-ink/70">
            <span>
              <span className="font-bold tabular-nums">
                {(safePage - 1) * pageSize + 1}
              </span>
              –
              <span className="font-bold tabular-nums">
                {Math.min(rows.length, safePage * pageSize)}
              </span>{" "}
              of <span className="font-bold tabular-nums">{rows.length}</span>
            </span>
            <span className="text-ink/40">·</span>
            <span>
              Page <span className="font-bold tabular-nums">{safePage}</span>{" "}
              / <span className="tabular-nums">{totalPages}</span>
            </span>
            <label className="flex items-center gap-1 text-ink/60">
              <span className="uppercase tracking-[0.2em]">Per page</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="border border-ink bg-bone px-2 py-1 font-mono text-[13px]"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage(1)}
              className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
            >
              « first
            </button>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
            >
              ← prev
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
            >
              next →
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage(totalPages)}
              className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
            >
              last »
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Format an ISO `YYYY-MM-DD` date of birth as `DD Mon YYYY` (e.g.
 * `12 Mar 2001`) so floor staff cannot confuse the day with the
 * month. Falls back to the raw string when parsing fails so we
 * never silently lose information.
 */
function formatDob(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const idx = Number(mo) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${d} ${months[idx]} ${y}`;
}

/**
 * True when the resolved weight bucket(s) for at least one entry on
 * this registration differ between the declared weight and the
 * measured weight. Drives the red "bracket changed" hint so floor
 * staff only get a warning when the change matters competitively —
 * a 78.4 → 78.6 reading inside the same bucket stays quiet.
 */
function bucketChanged(r: WeighInRow, measured: number | null): boolean {
  if (measured == null) return false;
  const declared = r.declared_weight_kg;
  if (declared == null) return false;
  if (Number(measured) === Number(declared)) return false;
  const regForResolve = {
    gender: r.gender ?? null,
    nonpara_classes: r.nonpara_classes ?? [],
    nonpara_hands: (r.nonpara_hands ?? []) as Array<"R" | "L" | "B" | null>,
    para_codes: r.para_codes ?? [],
    para_hand: r.para_hand ?? null,
    weight_overrides: r.weight_overrides ?? [],
  };
  const declaredRows = buildOverrideRows(regForResolve, Number(declared));
  const measuredRows = buildOverrideRows(regForResolve, Number(measured));
  const key = (b: { scope: string; code: string; selectedBucket: { code: string } }) =>
    `${b.scope}|${b.code}|${b.selectedBucket.code}`;
  const declaredKeys = declaredRows.map(key).sort().join(",");
  const measuredKeys = measuredRows.map(key).sort().join(",");
  return declaredKeys !== measuredKeys;
}

/**
 * Inline weight input + Save button. Posts straight to /api/weighin
 * with no photos and refreshes the row in place. Empty submission is
 * blocked; the input keeps focus on error so the operator can correct
 * a typo and re-submit without touching the mouse.
 *
 * For already-weighed rows, shows the captured weight with a "Re-weigh"
 * affordance that swaps the input back in without leaving the page.
 */
function QuickWeighIn({
  row,
  measured,
}: {
  row: WeighInRow;
  measured: number | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [kg, setKg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    const parsed = Number(kg);
    if (!Number.isFinite(parsed) || parsed < 20 || parsed > 250) {
      setErr("20–250 kg");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("registration_id", row.id);
      fd.set("measured_kg", parsed.toFixed(2));
      const res = await fetch("/api/weighin", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `failed (${res.status})`);
        setBusy(false);
        inputRef.current?.focus();
        return;
      }
      setBusy(false);
      setKg("");
      setEditing(false);
      setSavedFlash(true);
      router.refresh();
    } catch (e2) {
      setBusy(false);
      setErr((e2 as Error).message ?? "network");
      inputRef.current?.focus();
    }
  }

  // Already weighed and not currently editing → show the value + re-weigh.
  if (measured != null && !editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-base font-bold tabular-nums">
          {measured} kg
        </span>
        {savedFlash && (
          <span className="font-mono text-[11px] text-moss">saved</span>
        )}
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setSavedFlash(false);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="border border-ink/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] hover:border-ink"
        >
          Re-weigh
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        id={`weighin-kg-${row.id}`}
        type="number"
        inputMode="decimal"
        step="0.01"
        min={20}
        max={250}
        value={kg}
        onChange={(e) => {
          setKg(e.target.value);
          if (err) setErr(null);
        }}
        placeholder={
          row.declared_weight_kg != null ? String(row.declared_weight_kg) : "kg"
        }
        disabled={busy}
        className="w-20 border-2 border-ink bg-bone px-2 py-1 font-mono text-base font-bold tabular-nums disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={busy || !kg}
        className="border-2 border-ink bg-ink px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust hover:border-rust disabled:opacity-30"
      >
        {busy ? "…" : "Save"}
      </button>
      {editing && (
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setKg("");
            setErr(null);
          }}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
        >
          cancel
        </button>
      )}
      {err && (
        <span className="font-mono text-[11px] text-rust" role="alert">
          {err}
        </span>
      )}
    </form>
  );
}

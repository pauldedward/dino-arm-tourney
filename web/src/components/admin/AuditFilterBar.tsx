"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface Option {
  id: string;
  label: string;
}

interface CatalogEntry {
  action: string;
  label: string;
  category: string;
}

interface Initial {
  event: string;
  actor: string;
  action: string;
  category: string;
  since: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  payment: "Payments",
  registration: "Registrations",
  weighin: "Weigh-in",
  event: "Events",
  user: "Users",
  fixtures: "Brackets",
  export: "Exports",
  system: "System",
};

const PRESETS: Array<{ label: string; minutes: number }> = [
  { label: "Last hour", minutes: 60 },
  { label: "Today", minutes: 60 * 24 },
  { label: "Last 7d", minutes: 60 * 24 * 7 },
  { label: "Last 30d", minutes: 60 * 24 * 30 },
];

/**
 * Auto-applying audit filter bar — selects fire instantly. Selecting a
 * category narrows the action list; picking a specific action overrides it.
 * The CSV link mirrors the live filters.
 */
export default function AuditFilterBar({
  events,
  actors,
  catalog,
  initial,
}: {
  events: Option[];
  actors: Option[];
  catalog: CatalogEntry[];
  initial: Initial;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [event, setEvent] = useState(initial.event);
  const [actor, setActor] = useState(initial.actor);
  const [category, setCategory] = useState(initial.category);
  const [action, setAction] = useState(initial.action);
  const [since, setSince] = useState(initial.since);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of catalog) seen.set(c.category, CATEGORY_LABELS[c.category] ?? c.category);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [catalog]);

  const visibleActions = useMemo(() => {
    if (!category) return catalog;
    return catalog.filter((c) => c.category === category);
  }, [catalog, category]);

  // If the chosen action no longer matches the chosen category, clear it.
  useEffect(() => {
    if (action && category) {
      const ok = catalog.find((c) => c.action === action)?.category === category;
      if (!ok) setAction("");
    }
  }, [category, action, catalog]);

  // Push every change immediately. URLSearchParams handles encoding.
  useEffect(() => {
    const qs = new URLSearchParams(sp.toString());
    setOrDelete(qs, "event", event);
    setOrDelete(qs, "actor", actor);
    setOrDelete(qs, "category", category);
    setOrDelete(qs, "action", action);
    setOrDelete(qs, "since", since);
    router.replace(`${pathname}?${qs.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, actor, category, action, since]);

  function clearAll() {
    setEvent("");
    setActor("");
    setCategory("");
    setAction("");
    setSince("");
    router.replace(pathname);
  }

  function applyPreset(minutes: number) {
    const d = new Date(Date.now() - minutes * 60_000);
    // datetime-local needs YYYY-MM-DDTHH:mm in local time
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setSince(iso);
  }

  const csvHref = `/api/admin/audit.csv?${new URLSearchParams(
    Object.fromEntries(
      Object.entries({ event, actor, action, since }).filter(([, v]) => v)
    )
  ).toString()}`;

  const isDirty = !!(event || actor || category || action || since);

  return (
    <div className="space-y-3 border-2 border-ink p-3">
      {/* Quick presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
          Quick:
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p.minutes)}
            className="border-2 border-ink/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:border-ink hover:bg-kraft/30"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-6">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Event</span>
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            className="mt-1 block w-full border-2 border-ink bg-bone px-2 py-2 font-mono text-xs"
          >
            <option value="">(any)</option>
            {events.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 block w-full border-2 border-ink bg-bone px-2 py-2 font-mono text-xs"
          >
            <option value="">(any)</option>
            {categories.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Action</span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="mt-1 block w-full border-2 border-ink bg-bone px-2 py-2 font-mono text-xs"
          >
            <option value="">(any)</option>
            {visibleActions.map((c) => (
              <option key={c.action} value={c.action}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Actor</span>
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="mt-1 block w-full border-2 border-ink bg-bone px-2 py-2 font-mono text-xs"
          >
            <option value="">(any)</option>
            {actors.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Since</span>
          <input
            type="datetime-local"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="mt-1 block w-full border-2 border-ink bg-bone px-2 py-2 font-mono text-xs"
          />
        </label>

        <div className="flex items-end gap-2">
          <a
            href={csvHref}
            className="flex h-10 flex-1 items-center justify-center border-2 border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-kraft/30"
          >
            CSV ↓
          </a>
          {isDirty && (
            <button
              type="button"
              onClick={clearAll}
              className="h-10 border-2 border-ink/40 px-3 font-mono text-[10px] uppercase tracking-[0.2em] hover:border-ink"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function setOrDelete(qs: URLSearchParams, key: string, val: string) {
  if (val) qs.set(key, val);
  else qs.delete(key);
}

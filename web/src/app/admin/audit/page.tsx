import Link from "next/link";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import AuditFilterBar from "@/components/admin/AuditFilterBar";
import Pagination from "@/components/admin/Pagination";
import { resolveAuditTargets } from "@/lib/audit-resolver";
import {
  CATEGORY_STYLE,
  dayLabel,
  describeAction,
  listCatalog,
  relativeTime,
  type AuditCategory,
} from "@/lib/audit-format";

export const dynamic = "force-dynamic";

type Search = {
  event?: string;
  action?: string;
  category?: string;
  actor?: string;
  since?: string;
  page?: string;
  pageSize?: string;
};

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;
const DEFAULT_PAGE_SIZE = 200;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole("super_admin", "/admin/audit");
  const sp = await searchParams;

  const svc = createServiceClient();
  const catalog = listCatalog();

  const categoryActions = sp.category
    ? catalog.filter((c) => c.category === sp.category).map((c) => c.action)
    : null;

  const pageSizeRaw = Number.parseInt(sp.pageSize ?? "", 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeRaw)
    ? pageSizeRaw
    : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = svc
    .from("audit_log")
    .select(
      "id, created_at, event_id, actor_id, actor_label, action, target_table, target_id, payload",
      { count: "estimated" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.event) q = q.eq("event_id", sp.event);
  if (sp.action) q = q.eq("action", sp.action);
  else if (categoryActions && categoryActions.length > 0)
    q = q.in("action", categoryActions);
  if (sp.actor) q = q.eq("actor_id", sp.actor);
  if (sp.since) q = q.gte("created_at", sp.since);

  const [{ data: events }, { data: actors }, { data: rows, error, count }] =
    await Promise.all([
      svc
        .from("events")
        .select("id, name")
        .order("starts_at", { ascending: false })
        .limit(200),
      svc.from("profiles").select("id, full_name, email").limit(200),
      q,
    ]);
  const total = count ?? rows?.length ?? 0;

  const targets = await resolveAuditTargets(rows ?? []);

  const groups = new Map<string, NonNullable<typeof rows>>();
  for (const r of rows ?? []) {
    const key = dayLabel(r.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const activeFilters: Array<{ key: keyof Search; label: string; value: string }> = [];
  if (sp.event) {
    const ev = (events ?? []).find((e) => e.id === sp.event);
    activeFilters.push({ key: "event", label: "Event", value: ev?.name ?? sp.event });
  }
  if (sp.category) {
    const cat = CATEGORY_STYLE[sp.category as AuditCategory];
    activeFilters.push({
      key: "category",
      label: "Category",
      value: cat?.label ?? sp.category,
    });
  }
  if (sp.action) {
    const meta = catalog.find((c) => c.action === sp.action);
    activeFilters.push({ key: "action", label: "Action", value: meta?.label ?? sp.action });
  }
  if (sp.actor) {
    const a = (actors ?? []).find((x) => x.id === sp.actor);
    activeFilters.push({
      key: "actor",
      label: "Actor",
      value: a?.full_name ?? a?.email ?? sp.actor,
    });
  }
  if (sp.since) {
    activeFilters.push({
      key: "since",
      label: "Since",
      value: new Date(sp.since).toLocaleString(),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">
          Audit log · super admin
        </p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight">Audit</h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Append-only timeline. Newest first. Use the pager below to walk
          older entries; filters narrow the whole log, not just the page.
        </p>
      </div>

      <AuditFilterBar
        events={(events ?? []).map((e) => ({ id: e.id, label: e.name }))}
        actors={(actors ?? []).map((a) => ({
          id: a.id,
          label: a.full_name ?? a.email ?? a.id,
        }))}
        catalog={catalog}
        initial={{
          event: sp.event ?? "",
          actor: sp.actor ?? "",
          action: sp.action ?? "",
          category: sp.category ?? "",
          since: sp.since ?? "",
        }}
      />

      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
            Active filters:
          </span>
          {activeFilters.map((f) => {
            const next = new URLSearchParams();
            for (const [k, v] of Object.entries(sp)) {
              if (k !== f.key && typeof v === "string" && v) next.set(k, v);
            }
            const href = `/admin/audit${next.toString() ? `?${next.toString()}` : ""}`;
            return (
              <Link
                key={f.key}
                href={href}
                className="inline-flex items-center gap-1 border-2 border-ink bg-bone px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-rust hover:text-bone"
              >
                <span className="text-ink/50">{f.label}:</span>
                <span className="font-bold">{f.value}</span>
                <span aria-hidden>×</span>
              </Link>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <div className="border-2 border-rust p-3 font-mono text-xs text-rust">
          {error.message}
        </div>
      ) : null}

      {rows?.length ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          itemLabel="entries"
          options={PAGE_SIZE_OPTIONS}
          linkBase={{ path: "/admin/audit", params: sp }}
        />
      ) : null}

      {!rows?.length ? (
        <div className="border-2 border-dashed border-ink/30 p-10 text-center">
          <p className="font-display text-2xl">No activity</p>
          <p className="mt-2 font-mono text-xs text-ink/60">
            {activeFilters.length > 0
              ? "Nothing matches the active filters. Try clearing one."
              : "The audit log is empty."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([day, dayRows]) => (
            <section key={day} className="space-y-2">
              <h2 className="sticky top-0 z-10 -mx-2 flex items-baseline justify-between bg-bone/95 px-2 py-1 font-display text-xl font-black backdrop-blur">
                <span>{day}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/50">
                  {dayRows.length} event{dayRows.length === 1 ? "" : "s"}
                </span>
              </h2>
              <ul className="divide-y-2 divide-ink/10 border-2 border-ink">
                {dayRows.map((r) => (
                  <AuditRow
                    key={r.id}
                    row={r}
                    targets={targets}
                    eventName={
                      r.event_id
                        ? targets.events.get(r.event_id)?.name ?? null
                        : null
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {rows?.length ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          itemLabel="entries"
          options={PAGE_SIZE_OPTIONS}
          linkBase={{ path: "/admin/audit", params: sp }}
        />
      ) : null}
    </div>
  );
}

function buildAuditHref(sp: Search, overrides: Partial<Search>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v) next.set(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v == null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return `/admin/audit${qs ? `?${qs}` : ""}`;
}

function AuditRow({
  row,
  targets,
  eventName,
}: {
  row: {
    id: string;
    created_at: string;
    event_id: string | null;
    actor_id: string | null;
    actor_label: string | null;
    action: string;
    target_table: string | null;
    target_id: string | null;
    payload: Record<string, unknown> | null;
  };
  targets: Parameters<typeof describeAction>[1];
  eventName: string | null;
}) {
  const desc = describeAction(row, targets);
  const style = CATEGORY_STYLE[desc.category];
  const actor =
    (row.actor_id && targets.profiles.get(row.actor_id)?.label) ||
    row.actor_label ||
    (row.actor_id ? `user ${row.actor_id.slice(0, 8)}…` : "system");

  return (
    <li className={`grid gap-2 border-l-4 bg-bone p-3 md:grid-cols-[10rem_1fr] ${style.band}`}>
      <div className="font-mono text-[11px] text-ink/70">
        <div
          className="font-bold text-ink"
          title={new Date(row.created_at).toLocaleString()}
        >
          {relativeTime(row.created_at)}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-ink/50">
          {new Date(row.created_at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 border-2 border-ink px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${style.chip}`}
          >
            <span aria-hidden>{style.glyph}</span>
            <span>{style.label}</span>
          </span>
          <span className="font-display text-sm font-bold tracking-tight">
            {desc.label}
          </span>
          {eventName ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
              · {eventName}
            </span>
          ) : null}
        </div>

        <p className="font-sans text-sm text-ink">{desc.summary}</p>

        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
          by <span className="text-ink/80">{actor}</span>
        </p>

        {row.payload && Object.keys(row.payload).length > 0 ? (
          <details className="mt-1">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40 hover:text-ink">
              raw payload
            </summary>
            <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-words border-2 border-ink/10 bg-ink/[0.03] p-2 text-[10px] text-ink/70">
              {JSON.stringify(
                {
                  action: row.action,
                  target: row.target_table
                    ? `${row.target_table}:${row.target_id ?? ""}`
                    : null,
                  payload: row.payload,
                },
                null,
                2
              )}
            </pre>
          </details>
        ) : null}
      </div>
    </li>
  );
}

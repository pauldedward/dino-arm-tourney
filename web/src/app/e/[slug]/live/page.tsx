import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/db/supabase-service";
import LiveRefresh from "@/components/LiveRefresh";
import {
  computeCategoryStandings,
  type StandingFixture,
} from "@/lib/fixtures/standings";
import { formatCategoryCode } from "@/lib/rules/category-label";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MEDAL_ICON: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

// Public spectator view of live fixtures.
// /e/<slug>/live — no auth, RLS allows public select on fixtures + entries.
export default async function LivePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Public spectator page — no auth. Service client bypasses RLS so we can
  // join `entries -> registrations` (registrations are operator-only under
  // RLS, but the columns we expose here — name/chest/district — are already
  // public on draws and id-cards).
  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, slug, name, primary_color, text_on_primary, status")
    .eq("slug", slug)
    .neq("status", "draft")
    .maybeSingle();
  if (!event) redirect("/?gone=event");

  const [fxRes, entryRes] = await Promise.all([
    supabase
      .from("fixtures")
      .select(
        "id, category_code, bracket_side, round_no, match_no, entry_a_id, entry_b_id, winner_entry_id, status, mat_no, score_a, score_b, started_at",
      )
      .eq("event_id", event.id),
    supabase
      .from("entries")
      .select(
        "id, category_code, registrations!inner(chest_no, full_name, district)",
      )
      .eq("registrations.event_id", event.id),
  ]);

  type EntryInfo = {
    name: string;
    chest_no: number | null;
    district: string | null;
  };
  const entryMap = new Map<string, EntryInfo>();
  for (const e of entryRes.data ?? []) {
    const r = e.registrations as unknown as {
      chest_no: number | null;
      full_name: string;
      district: string | null;
    };
    entryMap.set(e.id, {
      name: r.full_name,
      chest_no: r.chest_no,
      district: r.district,
    });
  }

  const fixtures = fxRes.data ?? [];
  const liveNow = fixtures.filter((f) => f.status === "in_progress");
  liveNow.sort((a, b) => (a.mat_no ?? 99) - (b.mat_no ?? 99));

  // "Running" = any category with an in-progress fixture. Athletes in those
  // categories are on-deck and need to know their next bout.
  const runningCats = new Set(liveNow.map((f) => f.category_code));
  const upcomingByCat = new Map<string, typeof fixtures>();
  for (const f of fixtures) {
    if (f.status !== "scheduled") continue;
    if (!runningCats.has(f.category_code)) continue;
    if (!f.entry_a_id || !f.entry_b_id) continue; // skip TBD slots
    if (!upcomingByCat.has(f.category_code)) upcomingByCat.set(f.category_code, []);
    upcomingByCat.get(f.category_code)!.push(f);
  }
  const upcomingCats = Array.from(upcomingByCat.entries())
    .map(([code, rows]) => ({
      code,
      label: formatCategoryCode(code),
      next: rows
        .sort(
          (a, b) =>
            (a.round_no ?? 0) - (b.round_no ?? 0) ||
            (a.match_no ?? 0) - (b.match_no ?? 0),
        )
        .slice(0, 4),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  // Group live matches by table for the "Now playing" strip. Matches with
  // no table assignment land in a single trailing bucket so spectators can
  // still see them.
  const liveByTable = new Map<number | null, typeof liveNow>();
  for (const f of liveNow) {
    const t = f.mat_no ?? null;
    if (!liveByTable.has(t)) liveByTable.set(t, []);
    liveByTable.get(t)!.push(f);
  }
  const liveTableKeys = Array.from(liveByTable.keys()).sort((a, b) => {
    if (a == null) return 1;
    if (b == null) return -1;
    return a - b;
  });

  // Group for per-category podium.
  const byCat = new Map<string, StandingFixture[]>();
  for (const f of fixtures) {
    if (!byCat.has(f.category_code)) byCat.set(f.category_code, []);
    byCat.get(f.category_code)!.push({
      bracket_side: f.bracket_side as StandingFixture["bracket_side"],
      round_no: f.round_no,
      match_no: f.match_no,
      entry_a_id: f.entry_a_id,
      entry_b_id: f.entry_b_id,
      winner_entry_id: f.winner_entry_id,
      status: f.status as StandingFixture["status"],
    });
  }
  const finishedCats = Array.from(byCat.entries())
    .map(([code, rows]) => ({
      code,
      label: formatCategoryCode(code),
      podium: computeCategoryStandings(rows).map((s) => ({
        rank: s.rank,
        info: entryMap.get(s.entry_id) ?? null,
      })),
    }))
    .filter((c) => c.podium.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  const headerStyle = {
    background: event.primary_color ?? "#0f3d2e",
    color: event.text_on_primary ?? "#fff",
  };

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
      <LiveRefresh tables={["fixtures"]} eventId={event.id} />
      <header className="border-2 border-ink p-5" style={headerStyle}>
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] opacity-70">
          Live · {event.name}
        </p>
        <h1 className="mt-1 font-display text-3xl font-black">Match-day feed</h1>
        <Link
          href={`/e/${event.slug}`}
          className="mt-2 inline-block font-mono text-xs underline opacity-90"
        >
          ← Back to event
        </Link>
      </header>

      {/* Live now strip — grouped per table */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-black">Now playing</h2>
        {liveNow.length === 0 ? (
          <p className="border-2 border-ink p-4 font-mono text-sm text-ink/60">
            No match in progress.
          </p>
        ) : (
          <div className="space-y-5">
            {liveTableKeys.map((t) => (
              <div key={t ?? "no-table"}>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/70">
                  {t == null ? "Unassigned table" : `Table ${t}`}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {liveByTable.get(t)!.map((f) => {
                    const a = f.entry_a_id ? entryMap.get(f.entry_a_id) : null;
                    const b = f.entry_b_id ? entryMap.get(f.entry_b_id) : null;
                    return (
                      <div key={f.id} className="border-2 border-ink p-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
                          {formatCategoryCode(f.category_code)}
                        </p>
                        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                          <div>
                            <p className="font-display text-lg font-black">
                              {a?.name ?? "—"}
                            </p>
                            <p className="font-mono text-[11px] text-ink/60">
                              {a?.chest_no ?? "?"} · {a?.district ?? ""}
                            </p>
                            <p className="mt-1 font-mono text-2xl font-black">
                              {f.score_a}
                            </p>
                          </div>
                          <span className="font-display text-xl font-black opacity-50">
                            vs
                          </span>
                          <div className="text-right">
                            <p className="font-display text-lg font-black">
                              {b?.name ?? "—"}
                            </p>
                            <p className="font-mono text-[11px] text-ink/60">
                              {b?.chest_no ?? "?"} · {b?.district ?? ""}
                            </p>
                            <p className="mt-1 font-mono text-2xl font-black">
                              {f.score_b}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Up next per running category — helps on-deck athletes prepare */}
      {upcomingCats.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl font-black">Up next</h2>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink/60">
            Next bouts in categories currently on the table
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {upcomingCats.map((c) => (
              <div key={c.code} className="border-2 border-ink p-3">
                <p className="font-display text-sm font-black">{c.label}</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
                  {c.code}
                </p>
                <ul className="mt-2 space-y-2 font-mono text-xs">
                  {c.next.map((f) => {
                    const a = f.entry_a_id ? entryMap.get(f.entry_a_id) : null;
                    const b = f.entry_b_id ? entryMap.get(f.entry_b_id) : null;
                    return (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-2 border-t border-ink/15 pt-2 first:border-0 first:pt-0"
                      >
                        <span className="text-[10px] uppercase tracking-[0.2em] text-ink/50">
                          R{f.round_no}·M{f.match_no}
                          {f.mat_no != null ? ` · T${f.mat_no}` : ""}
                        </span>
                        <span className="flex-1 truncate text-right">
                          <span className="font-semibold">
                            {a?.name ?? "TBD"}
                          </span>
                          <span className="mx-1 opacity-50">vs</span>
                          <span className="font-semibold">
                            {b?.name ?? "TBD"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Completed podiums */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-black">Results</h2>
        {finishedCats.length === 0 ? (
          <p className="border-2 border-ink p-4 font-mono text-sm text-ink/60">
            Results will appear here as categories finish.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {finishedCats.map((c) => (
              <div key={c.code} className="border-2 border-ink p-3">
                <p className="font-display text-sm font-black">{c.label}</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
                  {c.code}
                </p>
                <ul className="mt-2 space-y-1 font-mono text-sm">
                  {c.podium.map((p) => (
                    <li key={p.rank} className="flex items-center gap-2">
                      <span>{MEDAL_ICON[p.rank] ?? `#${p.rank}`}</span>
                      <span className="truncate">
                        {p.info?.name ?? "—"}
                      </span>
                      {p.info?.district && (
                        <span className="ml-auto text-[11px] text-ink/60">
                          {p.info.district}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

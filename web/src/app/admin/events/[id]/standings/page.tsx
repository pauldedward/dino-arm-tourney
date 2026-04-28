import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import LiveRefresh from "@/components/LiveRefresh";
import {
  computeCategoryStandings,
  type StandingFixture,
} from "@/lib/fixtures/standings";
import { formatCategoryCode } from "@/lib/rules/category-label";

export const dynamic = "force-dynamic";

const MEDAL_LABEL: Record<number, string> = { 1: "Gold", 2: "Silver", 3: "Bronze" };
const MEDAL_DOT: Record<number, string> = {
  1: "bg-yellow-400",
  2: "bg-gray-300",
  3: "bg-amber-700",
};

export default async function StandingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("operator", "/admin/events");
  const { id: idOrSlug } = await params;
  const svc = createServiceClient();

  const looksUuid = /^[0-9a-f]{8}-/.test(idOrSlug);
  const { data: event } = await svc
    .from("events")
    .select("id, name, slug")
    .eq(looksUuid ? "id" : "slug", idOrSlug)
    .maybeSingle();
  if (!event) redirect("/admin/events?gone=event");

  const [fxRes, entryRes] = await Promise.all([
    svc
      .from("fixtures")
      .select(
        "category_code, bracket_side, round_no, match_no, entry_a_id, entry_b_id, winner_entry_id, status",
      )
      .eq("event_id", event.id),
    svc
      .from("entries")
      .select(
        "id, category_code, registrations!inner(chest_no, full_name, district, team)",
      )
      .eq("registrations.event_id", event.id),
  ]);

  if (fxRes.error)
    throw new Error(`fixtures load failed: ${fxRes.error.message}`);
  if (entryRes.error)
    throw new Error(`entries load failed: ${entryRes.error.message}`);

  type EntryInfo = {
    name: string;
    chest_no: number | null;
    district: string | null;
    team: string | null;
    category_code: string;
  };
  const entryMap = new Map<string, EntryInfo>();
  for (const e of entryRes.data ?? []) {
    const r = e.registrations as unknown as {
      chest_no: number | null;
      full_name: string;
      district: string | null;
      team: string | null;
    };
    entryMap.set(e.id, {
      name: r.full_name,
      chest_no: r.chest_no,
      district: r.district,
      team: r.team,
      category_code: e.category_code,
    });
  }

  // Group fixtures by category and compute standings.
  const byCat = new Map<string, StandingFixture[]>();
  for (const f of fxRes.data ?? []) {
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

  type CatBlock = {
    code: string;
    label: string;
    podium: Array<{ rank: number; entry_id: string; info: EntryInfo | null }>;
    finished: boolean;
  };

  const cats: CatBlock[] = Array.from(byCat.entries())
    .map(([code, rows]) => {
      const podium = computeCategoryStandings(rows).map((s) => ({
        rank: s.rank,
        entry_id: s.entry_id,
        info: entryMap.get(s.entry_id) ?? null,
      }));
      return {
        code,
        label: formatCategoryCode(code),
        podium,
        finished: podium.length > 0,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  // Medal table: count by district.
  const medals = new Map<string, { gold: number; silver: number; bronze: number }>();
  for (const c of cats) {
    for (const p of c.podium) {
      const d = p.info?.district ?? "Unknown";
      if (!medals.has(d)) medals.set(d, { gold: 0, silver: 0, bronze: 0 });
      const m = medals.get(d)!;
      if (p.rank === 1) m.gold += 1;
      else if (p.rank === 2) m.silver += 1;
      else if (p.rank === 3) m.bronze += 1;
    }
  }
  const medalRows = Array.from(medals.entries())
    .map(([district, m]) => ({ district, ...m, total: m.gold + m.silver + m.bronze }))
    .sort(
      (a, b) =>
        b.gold - a.gold ||
        b.silver - a.silver ||
        b.bronze - a.bronze ||
        a.district.localeCompare(b.district),
    );

  const finishedCats = cats.filter((c) => c.finished).length;

  return (
    <div className="space-y-8">
      <LiveRefresh tables={["fixtures"]} eventId={event.id} />
      <div className="flex items-end justify-between border-b-2 border-ink pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-70">
            Standings · {event.name}
          </p>
          <h1 className="font-display text-3xl font-black tracking-tight">
            Results &amp; medals
          </h1>
          <p className="mt-1 font-mono text-xs text-ink/60">
            {finishedCats}/{cats.length} categories finished
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/admin/events/${event.id}/run`}
            className="border-2 border-ink px-3 py-2 font-mono text-xs uppercase tracking-wide hover:bg-ink hover:text-paper"
          >
            ← Run fixtures
          </Link>
        </div>
      </div>

      {/* Medal table */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-black">Medal table</h2>
        {medalRows.length === 0 ? (
          <p className="font-mono text-xs text-ink/60">No completed categories yet.</p>
        ) : (
          <div className="overflow-x-auto border-2 border-ink">
            <table className="w-full font-mono text-sm">
              <thead className="bg-ink text-paper">
                <tr>
                  <th className="px-3 py-2 text-left">District</th>
                  <th className="px-3 py-2 text-right">🥇</th>
                  <th className="px-3 py-2 text-right">🥈</th>
                  <th className="px-3 py-2 text-right">🥉</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {medalRows.map((r) => (
                  <tr key={r.district} className="border-t border-ink/20">
                    <td className="px-3 py-2">{r.district}</td>
                    <td className="px-3 py-2 text-right">{r.gold}</td>
                    <td className="px-3 py-2 text-right">{r.silver}</td>
                    <td className="px-3 py-2 text-right">{r.bronze}</td>
                    <td className="px-3 py-2 text-right font-bold">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Per-category podium */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-black">By category</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cats.map((c) => (
            <div key={c.code} className="border-2 border-ink p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-display text-sm font-black">{c.label}</p>
                <Link
                  href={`/admin/events/${event.slug}/categories/${encodeURIComponent(c.code)}`}
                  className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60 underline-offset-2 hover:text-ink hover:underline"
                >
                  {c.code} ↗
                </Link>
              </div>
              {c.podium.length === 0 ? (
                <p className="mt-3 font-mono text-xs text-ink/50">
                  In progress
                </p>
              ) : (
                <ul className="mt-3 space-y-1 font-mono text-sm">
                  {c.podium.map((p) => (
                    <li
                      key={`${p.rank}-${p.entry_id}`}
                      className="flex items-center gap-2"
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          MEDAL_DOT[p.rank] ?? "bg-ink"
                        }`}
                      />
                      <span className="w-12 text-ink/60">
                        {MEDAL_LABEL[p.rank] ?? `#${p.rank}`}
                      </span>
                      <span className="font-bold">
                        {p.info?.chest_no ?? "?"}
                      </span>
                      <span className="truncate">
                        {p.info?.name ?? p.entry_id.slice(0, 8)}
                      </span>
                      {p.info?.district && (
                        <span className="ml-auto text-[11px] text-ink/60">
                          {p.info.district}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

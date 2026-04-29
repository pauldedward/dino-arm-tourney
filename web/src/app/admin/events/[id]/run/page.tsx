import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import LiveRefresh from "@/components/LiveRefresh";
import RunConsole from "@/components/admin/RunConsole";
import type { RunFixture, RunEntry, RunCategory } from "@/components/admin/RunConsole";
import { formatCategoryCode } from "@/lib/rules/category-label";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("operator", "/admin/events");
  const { id: idOrSlug } = await params;
  const svc = createServiceClient();

  // Resolve event id (slug or uuid).
  const looksUuid = /^[0-9a-f]{8}-/.test(idOrSlug);
  const { data: event } = await svc
    .from("events")
    .select("id, name, slug, status")
    .eq(looksUuid ? "id" : "slug", idOrSlug)
    .maybeSingle();
  if (!event) redirect("/admin/events?gone=event");

  // Fetch fixtures + entries + registrations in parallel.
  const [fxRes, entryRes] = await Promise.all([
    svc
      .from("fixtures")
      .select(
        "id, category_code, bracket_side, round_no, match_no, entry_a_id, entry_b_id, winner_entry_id, status, mat_no, best_of, score_a, score_b, started_at, completed_at",
      )
      .eq("event_id", event.id)
      .order("category_code", { ascending: true })
      .order("bracket_side", { ascending: true })
      .order("round_no", { ascending: true })
      .order("match_no", { ascending: true }),
    svc
      .from("entries")
      .select(
        "id, registration_id, category_code, registrations!inner(chest_no, full_name, district, photo_url)",
      )
      .eq("registrations.event_id", event.id),
  ]);

  if (fxRes.error)
    throw new Error(`fixtures load failed: ${fxRes.error.message}`);
  if (entryRes.error)
    throw new Error(`entries load failed: ${entryRes.error.message}`);

  const entryMap = new Map<string, RunEntry>();
  for (const e of entryRes.data ?? []) {
    const r = e.registrations as unknown as {
      chest_no: number | null;
      full_name: string;
      district: string | null;
      photo_url: string | null;
    };
    entryMap.set(e.id, {
      id: e.id,
      chest_no: r.chest_no,
      name: r.full_name,
      district: r.district,
      photo_url: r.photo_url,
    });
  }

  // Group fixtures by category.
  const grouped = new Map<string, RunFixture[]>();
  for (const f of fxRes.data ?? []) {
    if (!grouped.has(f.category_code)) grouped.set(f.category_code, []);
    grouped.get(f.category_code)!.push({
      id: f.id,
      bracket_side: f.bracket_side as "W" | "L" | "GF",
      round_no: f.round_no,
      match_no: f.match_no,
      entry_a_id: f.entry_a_id,
      entry_b_id: f.entry_b_id,
      winner_entry_id: f.winner_entry_id,
      status: f.status as RunFixture["status"],
      mat_no: f.mat_no,
      best_of: f.best_of ?? 1,
      score_a: f.score_a ?? 0,
      score_b: f.score_b ?? 0,
    });
  }

  const categories: RunCategory[] = Array.from(grouped.entries())
    .map(([code, fixtures]) => {
      // Derive a single table_no for the whole category from its fixtures.
      // We only ever bulk-set mat_no on (event, category_code), so any
      // non-null mat_no on a not-yet-completed fixture is the answer.
      const tableSrc = fixtures.find(
        (f) => f.mat_no != null && f.status !== "completed",
      )?.mat_no ?? null;
      return {
        code,
        label: formatCategoryCode(code),
        fixtures,
        table_no: tableSrc,
        total: fixtures.length,
        completed: fixtures.filter((f) => f.status === "completed").length,
        in_progress: fixtures.filter((f) => f.status === "in_progress").length,
      };
    })
    .sort((a, b) => {
      // Sort by table number first (tables grouped together), then code.
      const ta = a.table_no ?? 999;
      const tb = b.table_no ?? 999;
      if (ta !== tb) return ta - tb;
      return a.code.localeCompare(b.code);
    });

  return (
    <div className="space-y-6">
      <LiveRefresh tables={["fixtures", "entries"]} eventId={event.id} />
      <div className="flex items-end justify-between border-b-2 border-ink pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-70">
            Match-day · {event.name}
          </p>
          <h1 className="font-display text-3xl font-black tracking-tight">
            Run fixtures
          </h1>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/admin/events/${event.id}/standings`}
            className="border-2 border-ink px-3 py-2 font-mono text-xs uppercase tracking-wide hover:bg-ink hover:text-paper"
          >
            Standings&nbsp;→
          </Link>
          <Link
            href={`/admin/events/${event.id}`}
            className="border-2 border-ink px-3 py-2 font-mono text-xs uppercase tracking-wide hover:bg-ink hover:text-paper"
          >
            ← Event home
          </Link>
        </div>
      </div>

      <RunConsole
        eventId={event.id}
        eventSlug={event.slug}
        categories={categories}
        entries={Object.fromEntries(entryMap)}
      />
    </div>
  );
}

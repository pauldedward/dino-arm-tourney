import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { formatCategoryCode } from "@/lib/rules/category-label";

export const dynamic = "force-dynamic";

type FixtureRow = {
  id: string;
  bracket_side: "W" | "L" | "GF";
  round_no: number;
  match_no: number;
  entry_a_id: string | null;
  entry_b_id: string | null;
  winner_entry_id: string | null;
  status: "scheduled" | "in_progress" | "completed" | "void";
  mat_no: number | null;
  score_a: number;
  score_b: number;
};

type EntryInfo = {
  chest_no: number | null;
  name: string;
  district: string | null;
};

const SIDE_ORDER: Array<"W" | "L" | "GF"> = ["W", "L", "GF"];
const SIDE_LABEL: Record<"W" | "L" | "GF", string> = {
  W: "Winners bracket",
  L: "Losers bracket",
  GF: "Grand final",
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default async function CategoryBracketPage({
  params,
}: {
  params: Promise<{ id: string; code: string }>;
}) {
  await requireRole("operator", "/admin");
  const { id: idOrSlug, code: rawCode } = await params;
  // Next 16 dynamic params are not URL-decoded for non-ASCII segments.
  // Category codes contain U+2212 (−) which arrives as %E2%88%92.
  const code = safeDecode(rawCode);
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
        "id, bracket_side, round_no, match_no, entry_a_id, entry_b_id, winner_entry_id, status, mat_no, score_a, score_b",
      )
      .eq("event_id", event.id)
      .eq("category_code", code)
      .order("bracket_side", { ascending: true })
      .order("round_no", { ascending: true })
      .order("match_no", { ascending: true }),
    svc
      .from("entries")
      .select(
        "id, registrations!inner(chest_no, full_name, district, event_id)",
      )
      .eq("category_code", code)
      .eq("registrations.event_id", event.id),
  ]);

  if (fxRes.error)
    throw new Error(`fixtures load failed: ${fxRes.error.message}`);
  if (entryRes.error)
    throw new Error(`entries load failed: ${entryRes.error.message}`);

  const entries = new Map<string, EntryInfo>();
  for (const e of entryRes.data ?? []) {
    const r = e.registrations as unknown as {
      chest_no: number | null;
      full_name: string;
      district: string | null;
    };
    entries.set(e.id, {
      chest_no: r.chest_no,
      name: r.full_name,
      district: r.district,
    });
  }

  const fixtures = (fxRes.data ?? []) as FixtureRow[];

  // Group by bracket_side -> round_no -> [fixtures].
  type Round = { round: number; fixtures: FixtureRow[] };
  type Side = { side: "W" | "L" | "GF"; rounds: Round[] };
  const sides: Side[] = SIDE_ORDER.flatMap((sd) => {
    const sideRows = fixtures.filter((f) => f.bracket_side === sd);
    if (sideRows.length === 0) return [];
    const byRound = new Map<number, FixtureRow[]>();
    for (const f of sideRows) {
      if (!byRound.has(f.round_no)) byRound.set(f.round_no, []);
      byRound.get(f.round_no)!.push(f);
    }
    const rounds: Round[] = Array.from(byRound.entries())
      .map(([round, list]) => ({ round, fixtures: list }))
      .sort((a, b) => a.round - b.round);
    return [{ side: sd, rounds }];
  });

  const tableNo =
    fixtures.find((f) => f.mat_no != null && f.status !== "completed")
      ?.mat_no ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between border-b-2 border-ink pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-70">
            Bracket · {event.name}
          </p>
          <h1 className="font-display text-3xl font-black tracking-tight">
            {formatCategoryCode(code)}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            {code}
            {tableNo != null && ` · Table ${tableNo}`}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/admin/events/${event.slug}/run`}
            className="border-2 border-ink px-3 py-2 font-mono text-xs uppercase tracking-wide hover:bg-ink hover:text-paper"
          >
            Run console&nbsp;→
          </Link>
          <Link
            href={`/admin/events/${event.id}`}
            className="border-2 border-ink px-3 py-2 font-mono text-xs uppercase tracking-wide hover:bg-ink hover:text-paper"
          >
            ← Event home
          </Link>
        </div>
      </div>

      {fixtures.length === 0 && (
        <p className="border-2 border-ink p-6 font-mono text-sm">
          No fixtures for this category.
        </p>
      )}

      {sides.map((s) => (
        <section key={s.side} className="space-y-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink/70">
            {SIDE_LABEL[s.side]}
          </h2>
          <div className="overflow-x-auto">
            <div
              className="grid items-start gap-4"
              style={{
                gridTemplateColumns: `repeat(${s.rounds.length}, minmax(220px, 1fr))`,
              }}
            >
              {s.rounds.map((r) => (
                <div key={r.round} className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
                    Round {r.round}
                  </p>
                  <div className="space-y-2">
                    {r.fixtures.map((f) => (
                      <BracketCard key={f.id} fixture={f} entries={entries} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function BracketCard({
  fixture: f,
  entries,
}: {
  fixture: FixtureRow;
  entries: Map<string, EntryInfo>;
}) {
  const a = f.entry_a_id ? entries.get(f.entry_a_id) ?? null : null;
  const b = f.entry_b_id ? entries.get(f.entry_b_id) ?? null : null;
  const aWon = f.winner_entry_id != null && f.winner_entry_id === f.entry_a_id;
  const bWon = f.winner_entry_id != null && f.winner_entry_id === f.entry_b_id;
  const statusBorder =
    f.status === "in_progress"
      ? "border-emerald-700"
      : f.status === "completed"
        ? "border-ink"
        : f.status === "void"
          ? "border-ink/30"
          : "border-ink/40";
  return (
    <div
      className={`border-2 ${statusBorder} bg-paper p-2 font-mono text-xs`}
      title={`M${f.match_no} · ${f.status}`}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-ink/50">
        <span>M{f.match_no}</span>
        <span>
          {f.status === "in_progress" && "▶ live"}
          {f.status === "void" && "void"}
          {f.status === "scheduled" && "scheduled"}
          {f.status === "completed" && "done"}
        </span>
      </div>
      <Side entry={a} score={f.score_a} won={aWon} />
      <Side entry={b} score={f.score_b} won={bWon} />
    </div>
  );
}

function Side({
  entry,
  score,
  won,
}: {
  entry: EntryInfo | null;
  score: number;
  won: boolean;
}) {
  return (
    <div
      className={`mt-1 flex items-center justify-between gap-2 border-t border-ink/20 py-1 ${
        won ? "font-bold" : ""
      } ${entry == null ? "text-ink/40" : ""}`}
    >
      <span className="truncate">
        <span className="mr-1 inline-block w-6 text-right text-ink/60">
          {entry?.chest_no ?? "—"}
        </span>
        {entry?.name ?? "TBD"}
      </span>
      <span className="shrink-0 text-ink/70">{score}</span>
    </div>
  );
}

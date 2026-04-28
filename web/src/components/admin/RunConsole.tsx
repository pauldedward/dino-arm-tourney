"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type RunFixture = {
  id: string;
  bracket_side: "W" | "L" | "GF";
  round_no: number;
  match_no: number;
  entry_a_id: string | null;
  entry_b_id: string | null;
  winner_entry_id: string | null;
  status: "scheduled" | "in_progress" | "completed" | "void";
  mat_no: number | null;
  best_of: number;
  score_a: number;
  score_b: number;
};

export type RunEntry = {
  id: string;
  chest_no: number | null;
  name: string;
  district: string | null;
  photo_url: string | null;
};

export type RunCategory = {
  code: string;
  label: string;
  fixtures: RunFixture[];
  table_no: number | null;
  total: number;
  completed: number;
  in_progress: number;
};

interface Props {
  eventId: string;
  eventSlug: string;
  categories: RunCategory[];
  entries: Record<string, RunEntry>;
}

function sideLabel(side: "W" | "L" | "GF"): string {
  if (side === "W") return "Winners";
  if (side === "L") return "Losers";
  return "Grand Final";
}

function shortLabel(side: "W" | "L" | "GF", round: number, match: number): string {
  return `${side}${round}.${match}`;
}

/** Human-friendly round name from the position in the bracket. */
function roundName(
  side: "W" | "L" | "GF",
  round: number,
  match: number,
  allFixtures: RunFixture[],
): string {
  if (side === "GF") return match === 1 ? "Grand Final" : "Grand Final (reset)";
  // Look at how many matches exist in this side+round to detect terminal rounds.
  const sameSide = allFixtures.filter((f) => f.bracket_side === side);
  const maxRound = sameSide.reduce((m, f) => Math.max(m, f.round_no), 0);
  if (round === maxRound) {
    return side === "W" ? "Winners Final" : "Losers Final";
  }
  if (side === "W" && round === maxRound - 1) return "Winners Semifinal";
  if (side === "L" && round === maxRound - 1) return "Losers Semifinal";
  return `${side === "W" ? "Winners" : "Losers"} R${round}`;
}

export default function RunConsole({ eventId, eventSlug, categories, entries }: Props) {
  const router = useRouter();
  const [activeCode, setActiveCode] = useState<string>(
    categories.find((c) => c.in_progress + (c.total - c.completed) > 0)?.code ??
      categories[0]?.code ??
      "",
  );
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  void eventId; // available for future scoped fetches

  const active = categories.find((c) => c.code === activeCode);

  // Within active category, separate buckets.
  const buckets = useMemo(() => {
    if (!active) return { live: [], next: [], waiting: [], done: [] };
    const live: RunFixture[] = [];
    const next: RunFixture[] = [];
    const waiting: RunFixture[] = [];
    const done: RunFixture[] = [];
    for (const f of active.fixtures) {
      if (f.status === "in_progress") live.push(f);
      else if (f.status === "scheduled" && f.entry_a_id && f.entry_b_id) next.push(f);
      else if (f.status === "scheduled" && (f.entry_a_id || f.entry_b_id))
        waiting.push(f);
      else if (f.status === "completed") done.push(f);
    }
    const orderKey = (a: RunFixture, b: RunFixture) =>
      a.bracket_side.localeCompare(b.bracket_side) ||
      a.round_no - b.round_no ||
      a.match_no - b.match_no;
    next.sort(orderKey);
    waiting.sort(orderKey);
    done.sort((a, b) => b.round_no - a.round_no || b.match_no - a.match_no);
    return { live, next, waiting, done };
  }, [active]);

  async function call(path: string, body: object | null) {
    setErr(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : null,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function start(f: RunFixture) {
    setBusyId(f.id);
    try {
      await call(`/api/fixtures/${f.id}/start`, { mat_no: null });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function complete(
    f: RunFixture,
    winner: "A" | "B",
    method: string = "points",
    finalScoreA?: number,
    finalScoreB?: number,
  ) {
    setBusyId(f.id);
    try {
      const sa = finalScoreA ?? (winner === "A" ? Math.max(1, f.score_a) : f.score_a);
      const sb = finalScoreB ?? (winner === "B" ? Math.max(1, f.score_b) : f.score_b);
      await call(`/api/fixtures/${f.id}/complete`, {
        winner,
        score_a: sa,
        score_b: sb,
        method,
      });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  // Best-of-N support: clicking "A wins game" increments score_a. If A's
  // game-wins reach ceil(best_of/2), the match closes with A as winner.
  // Otherwise, just update the live score and stay in_progress.
  async function gameWin(f: RunFixture, side: "A" | "B") {
    const target = Math.ceil(f.best_of / 2);
    const newA = side === "A" ? f.score_a + 1 : f.score_a;
    const newB = side === "B" ? f.score_b + 1 : f.score_b;
    if (newA >= target || newB >= target) {
      await complete(f, newA >= target ? "A" : "B", "points", newA, newB);
      return;
    }
    setBusyId(f.id);
    try {
      await call(`/api/fixtures/${f.id}/score`, {
        score_a: newA,
        score_b: newB,
      });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function undo(f: RunFixture) {
    if (!confirm("Undo this completed match? Downstream slot will be cleared.")) return;
    setBusyId(f.id);
    try {
      await call(`/api/fixtures/${f.id}/undo`, null);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function setTable(code: string, raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next <= 0 || next >= 1000)) {
      setErr(`Invalid table number: ${raw}`);
      return;
    }
    setBusyId(`cat:${code}`);
    try {
      await call(
        `/api/events/${encodeURIComponent(eventSlug)}/categories/${encodeURIComponent(code)}/table`,
        { table_no: next },
      );
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (categories.length === 0) {
    return (
      <p className="border-2 border-ink p-6 font-mono text-sm">
        No fixtures yet. Generate fixtures from the event dashboard first.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Category rail */}
      <aside className="border-2 border-ink bg-paper">
        <div className="flex items-baseline justify-between border-b-2 border-ink bg-ink px-3 py-2">
          <p className="font-display text-sm font-black uppercase tracking-[0.2em] text-paper">
            Categories
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-paper/70">
            {categories.length}
          </p>
        </div>
        <ul className="max-h-[78vh] divide-y divide-ink/10 overflow-y-auto">
          {categories.map((c) => {
            const remaining = c.total - c.completed;
            const isActive = c.code === activeCode;
            const isDone = remaining === 0;
            return (
              <li key={c.code}>
                <button
                  type="button"
                  onClick={() => setActiveCode(c.code)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? "bg-moss text-paper"
                      : isDone
                        ? "text-ink/55 hover:bg-bone"
                        : "text-ink hover:bg-bone"
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center border-2 font-display text-sm font-black tabular-nums ${
                      c.table_no == null
                        ? isActive
                          ? "border-paper/40 text-paper/60"
                          : "border-ink/20 text-ink/35"
                        : isActive
                          ? "border-paper bg-paper text-moss"
                          : "border-ink bg-ink text-paper"
                    }`}
                    title={c.table_no == null ? "No table assigned" : `Table ${c.table_no}`}
                  >
                    {c.table_no ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-bold leading-tight">
                      {c.label}
                    </span>
                    <span
                      className={`block font-mono text-[10px] uppercase tracking-[0.2em] ${
                        isActive ? "text-paper/75" : "text-ink/55"
                      }`}
                    >
                      {c.completed}/{c.total} done
                      {c.in_progress > 0 && ` · ${c.in_progress} live`}
                      {isDone && " · ✓"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Main column */}
      <section className="space-y-6">
        {err && (
          <div className="flex items-start gap-3 border-2 border-rust bg-rust/10 p-3 font-mono text-xs text-rust">
            <span className="font-display text-base font-black uppercase tracking-wide">!</span>
            <span className="flex-1">{err}</span>
            <button
              type="button"
              onClick={() => setErr(null)}
              className="shrink-0 border border-rust px-2 py-0.5 text-[10px] uppercase tracking-wide hover:bg-rust hover:text-paper"
            >
              dismiss
            </button>
          </div>
        )}

        {!active ? (
          <p className="font-mono text-sm">Select a category.</p>
        ) : (
          <>
            <header className="border-2 border-ink bg-paper">
              <div className="flex flex-wrap items-stretch justify-between gap-0">
                <div className="flex-1 px-5 py-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-rust">
                    Now running
                  </p>
                  <h2 className="mt-1 font-display text-3xl font-black leading-tight tracking-tight">
                    {active.label}
                  </h2>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/55">
                    {active.completed}/{active.total} matches done
                    {pending && " · refreshing…"}
                  </p>
                </div>
                <div className="flex items-stretch border-l-2 border-ink">
                  <TableEditor
                    code={active.code}
                    value={active.table_no}
                    busy={busyId === `cat:${active.code}`}
                    onSet={(raw) => setTable(active.code, raw)}
                  />
                  <a
                    href={`/admin/events/${encodeURIComponent(eventSlug)}/categories/${encodeURIComponent(active.code)}`}
                    className="grid place-items-center border-l-2 border-ink bg-bone px-4 font-mono text-[10px] uppercase tracking-[0.25em] text-ink hover:bg-ink hover:text-paper"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Bracket ↗
                  </a>
                </div>
              </div>
            </header>

            <HintBanner
              live={buckets.live.length}
              ready={buckets.next.length}
              waiting={buckets.waiting.length}
              done={buckets.done.length}
              total={active.total}
            />

            <Section
              title={`Live now (${buckets.live.length})`}
              accent="live"
              hint="A match is on the table right now. Tap the winning athlete's button when the match ends."
            >
              {buckets.live.length === 0 && (
                <p className="font-mono text-xs text-ink/60">No match in progress.</p>
              )}
              {buckets.live.map((f) => (
                <MatchCard
                  key={f.id}
                  fixture={f}
                  entries={entries}
                  busy={busyId === f.id}
                  onGameWin={(side) => gameWin(f, side)}
                  onCloseByMethod={(side, method) => complete(f, side, method)}
                  allFixtures={active.fixtures}
                />
              ))}
            </Section>

            <Section
              title={`Ready to start (${buckets.next.length})`}
              accent="ready"
              hint="Both athletes confirmed. Press START when they're at the table."
            >
              {buckets.next.length === 0 && (
                <p className="font-mono text-xs text-ink/60">Nothing ready.</p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {buckets.next.map((f) => (
                  <UpNextCard
                    key={f.id}
                    fixture={f}
                    entries={entries}
                    busy={busyId === f.id}
                    onStart={() => start(f)}
                    allFixtures={active.fixtures}
                  />
                ))}
              </div>
            </Section>

            {buckets.waiting.length > 0 && (
              <Section
                title={`Waiting for opponent (${buckets.waiting.length})`}
                accent="waiting"
                hint="One athlete confirmed; the other will be the winner/loser of an earlier match still in progress."
              >
                <ul className="space-y-1 font-mono text-xs">
                  {buckets.waiting.map((f) => {
                    const a = f.entry_a_id ? entries[f.entry_a_id] : null;
                    const b = f.entry_b_id ? entries[f.entry_b_id] : null;
                    const present = a ?? b;
                    return (
                      <li
                        key={f.id}
                        className="flex items-center justify-between border-b border-ink/10 py-1 text-ink/70"
                      >
                        <span>
                          <span className="mr-2 inline-block w-12 text-ink/60">
                            {shortLabel(f.bracket_side, f.round_no, f.match_no)}
                          </span>
                          <span className="font-bold">
                            {present?.chest_no ?? "?"}
                          </span>{" "}
                          {present?.name ?? "—"}
                          <span className="mx-2 opacity-50">vs</span>
                          <span className="italic opacity-60">TBD</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            <Section
              title={`Completed (${buckets.done.length})`}
              accent="done"
              hint="Past results. Use Undo only to fix a mistake — it reopens the match and clears any downstream slots."
            >
              <ul className="space-y-1 font-mono text-xs">
                {buckets.done.map((f) => {
                  const winner = f.winner_entry_id
                    ? entries[f.winner_entry_id]
                    : null;
                  const a = f.entry_a_id ? entries[f.entry_a_id] : null;
                  const b = f.entry_b_id ? entries[f.entry_b_id] : null;
                  return (
                    <li
                      key={f.id}
                      className="flex items-center justify-between border-b border-ink/10 py-1"
                    >
                      <span>
                        <span className="mr-2 inline-block w-12 text-ink/60">
                          {shortLabel(f.bracket_side, f.round_no, f.match_no)}
                        </span>
                        <span className={f.winner_entry_id === a?.id ? "font-bold" : ""}>
                          {a ? `${a.chest_no ?? "?"} ${a.name}` : "—"}
                        </span>
                        <span className="mx-2 opacity-50">vs</span>
                        <span className={f.winner_entry_id === b?.id ? "font-bold" : ""}>
                          {b ? `${b.chest_no ?? "?"} ${b.name}` : "—"}
                        </span>
                        {winner && (
                          <span className="ml-3 text-emerald-700">
                            ✓ {winner.name}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => undo(f)}
                        disabled={busyId === f.id}
                        className="border border-ink/30 px-2 py-0.5 text-[10px] uppercase hover:bg-ink hover:text-paper disabled:opacity-50"
                      >
                        Undo
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          </>
        )}
      </section>
    </div>
  );
}

type SectionAccent = "live" | "ready" | "waiting" | "done";

const SECTION_STYLES: Record<SectionAccent, { bar: string; eyebrow: string; eyebrowText: string }> = {
  live:    { bar: "bg-moss",    eyebrow: "bg-moss",    eyebrowText: "text-paper" },
  ready:   { bar: "bg-ink",     eyebrow: "bg-ink",     eyebrowText: "text-paper" },
  waiting: { bar: "bg-kraft",   eyebrow: "bg-kraft",   eyebrowText: "text-ink"   },
  done:    { bar: "bg-ink/30",  eyebrow: "bg-ink/10",  eyebrowText: "text-ink/70"},
};

function Section({
  title,
  hint,
  accent = "done",
  children,
}: {
  title: string;
  hint?: string;
  accent?: SectionAccent;
  children: React.ReactNode;
}) {
  const s = SECTION_STYLES[accent];
  return (
    <section className="space-y-3">
      <header className="flex items-baseline gap-3">
        <span
          className={`inline-block px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] ${s.eyebrow} ${s.eyebrowText}`}
        >
          {title}
        </span>
        {hint && (
          <span className="hidden font-mono text-[11px] italic text-ink/55 md:inline">
            {hint}
          </span>
        )}
      </header>
      <div className={`space-y-3 border-l-2 ${s.bar} pl-4`}>{children}</div>
    </section>
  );
}

function HintBanner({
  live,
  ready,
  waiting,
  done,
  total,
}: {
  live: number;
  ready: number;
  waiting: number;
  done: number;
  total: number;
}) {
  const tone =
    live > 0
      ? { eyebrow: "On the table",       text: "Tap the winning athlete on the LIVE card.",        bg: "bg-moss",  fg: "text-paper" }
      : ready > 0
        ? { eyebrow: "Ready to start",     text: "Press START on a Ready match to put it on the table.", bg: "bg-ink",   fg: "text-paper" }
        : waiting > 0
          ? { eyebrow: "Waiting upstream",   text: "All scheduled matches need an earlier match to finish.", bg: "bg-kraft", fg: "text-ink"   }
          : done === total && total > 0
            ? { eyebrow: "Category complete", text: "Open Standings to see the podium.",                  bg: "bg-gold",  fg: "text-ink"   }
            : { eyebrow: "Idle",               text: "Nothing to do here.",                                bg: "bg-bone",  fg: "text-ink"   };
  return (
    <div className={`grid grid-cols-[auto_1fr] items-stretch border-2 border-ink ${tone.bg} ${tone.fg}`}>
      <div className="flex items-center justify-center border-r-2 border-ink px-4">
        <span className="font-display text-3xl font-black leading-none">
          {live + ready + waiting + done}/{total}
        </span>
      </div>
      <div className="flex flex-col justify-center px-4 py-3">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] opacity-80">
          Next — {tone.eyebrow}
        </p>
        <p className="font-display text-lg font-black leading-tight">{tone.text}</p>
      </div>
    </div>
  );
}

function MatchCard({
  fixture,
  entries,
  busy,
  onGameWin,
  onCloseByMethod,
  allFixtures,
}: {
  fixture: RunFixture;
  entries: Record<string, RunEntry>;
  busy: boolean;
  /** Records a single game win for a side. For best_of=1 this also closes the match. */
  onGameWin: (side: "A" | "B") => void;
  /** Force-close the match for a side with a non-points method (DQ, pin, forfeit, injury). */
  onCloseByMethod: (side: "A" | "B", method: string) => void;
  allFixtures: RunFixture[];
}) {
  const a = fixture.entry_a_id ? entries[fixture.entry_a_id] : null;
  const b = fixture.entry_b_id ? entries[fixture.entry_b_id] : null;
  const target = Math.ceil(fixture.best_of / 2);
  const isBestOfN = fixture.best_of > 1;
  const niceName = roundName(fixture.bracket_side, fixture.round_no, fixture.match_no, allFixtures);
  return (
    <div className="border-2 border-moss bg-paper shadow-[6px_6px_0_0_rgba(15,61,46,0.18)]">
      <div className="flex items-center justify-between gap-3 border-b-2 border-moss bg-moss px-4 py-2 font-mono text-[10px] uppercase tracking-[0.3em] text-paper">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gold" aria-hidden />
          {fixture.mat_no != null && (
            <span className="border border-paper/60 bg-paper/10 px-1.5 py-0.5 text-paper">
              Table {fixture.mat_no}
            </span>
          )}
          <span className="font-bold">{niceName}</span>
          <span className="opacity-70">· Match {fixture.match_no}</span>
          {isBestOfN && <span className="opacity-70">· Best of {fixture.best_of} (first to {target})</span>}
        </span>
        <span className="font-bold text-gold">LIVE</span>
      </div>
      <div className="p-5">
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <PersonBlock side="A" entry={a} score={fixture.score_a} />
        <span className="font-display text-3xl font-black italic text-ink/40">vs</span>
        <PersonBlock side="B" entry={b} score={fixture.score_b} align="right" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onGameWin("A")}
          disabled={busy || !a}
          className="group relative border-2 border-ink bg-paper px-3 py-4 text-left transition-colors hover:bg-moss hover:text-paper disabled:opacity-40"
        >
          <span className="block font-mono text-[10px] uppercase tracking-[0.3em] text-ink/55 group-hover:text-paper/75">
            ✓ {isBestOfN ? "Game to side A" : "Winner"}
          </span>
          <span className="mt-1 block font-display text-xl font-black leading-tight">
            {a ? a.name : "—"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onGameWin("B")}
          disabled={busy || !b}
          className="group relative border-2 border-ink bg-paper px-3 py-4 text-right transition-colors hover:bg-moss hover:text-paper disabled:opacity-40"
        >
          <span className="block font-mono text-[10px] uppercase tracking-[0.3em] text-ink/55 group-hover:text-paper/75">
            {isBestOfN ? "Game to side B" : "Winner"} ✓
          </span>
          <span className="mt-1 block font-display text-xl font-black leading-tight">
            {b ? b.name : "—"}
          </span>
        </button>
      </div>
      <CloseByMethod
        sideALabel={a?.name ?? "—"}
        sideBLabel={b?.name ?? "—"}
        canA={!!a && !busy}
        canB={!!b && !busy}
        onClose={onCloseByMethod}
      />
      </div>
    </div>
  );
}

const CLOSE_METHODS: Array<{ value: string; label: string }> = [
  { value: "pin", label: "Pin" },
  { value: "disqualification", label: "DQ (3 fouls)" },
  { value: "forfeit", label: "Forfeit" },
  { value: "injury", label: "Injury" },
];

function CloseByMethod({
  sideALabel,
  sideBLabel,
  canA,
  canB,
  onClose,
}: {
  sideALabel: string;
  sideBLabel: string;
  canA: boolean;
  canB: boolean;
  onClose: (side: "A" | "B", method: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<string>("pin");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full border border-ink/30 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60 hover:bg-ink hover:text-paper"
      >
        End by other method…
      </button>
    );
  }
  return (
    <div className="mt-3 space-y-2 border border-ink/30 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
          End by
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-[10px] uppercase text-ink/50 hover:text-ink"
        >
          cancel
        </button>
      </div>
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        className="w-full border border-ink/40 bg-paper px-2 py-1 font-mono text-xs"
      >
        {CLOSE_METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onClose("A", method)}
          disabled={!canA}
          className="border border-ink bg-paper py-1.5 font-mono text-[11px] uppercase tracking-wide hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {sideALabel} wins
        </button>
        <button
          type="button"
          onClick={() => onClose("B", method)}
          disabled={!canB}
          className="border border-ink bg-paper py-1.5 font-mono text-[11px] uppercase tracking-wide hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {sideBLabel} wins
        </button>
      </div>
    </div>
  );
}

function UpNextCard({
  fixture,
  entries,
  busy,
  onStart,
  allFixtures,
}: {
  fixture: RunFixture;
  entries: Record<string, RunEntry>;
  busy: boolean;
  onStart: () => void;
  allFixtures: RunFixture[];
}) {
  const a = fixture.entry_a_id ? entries[fixture.entry_a_id] : null;
  const b = fixture.entry_b_id ? entries[fixture.entry_b_id] : null;
  const niceName = roundName(fixture.bracket_side, fixture.round_no, fixture.match_no, allFixtures);
  return (
    <div className="group border-2 border-ink bg-paper transition-shadow hover:shadow-[6px_6px_0_0_#0A1B14]">
      <div className="border-b-2 border-ink bg-bone px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-ink">
        <span className="font-bold">{niceName}</span>
        <span className="ml-1 opacity-60">· Match {fixture.match_no}</span>
      </div>
      <div className="px-3 py-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/55">
              Chest {a?.chest_no ?? "?"}
            </p>
            <p className="font-display text-base font-black leading-tight">
              {a?.name ?? "—"}
            </p>
          </div>
          <span className="font-display text-lg italic text-ink/40">vs</span>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/55">
              Chest {b?.chest_no ?? "?"}
            </p>
            <p className="font-display text-base font-black leading-tight">
              {b?.name ?? "—"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 border-2 border-ink bg-ink py-2.5 font-display text-sm font-black uppercase tracking-[0.2em] text-paper transition-colors hover:bg-moss disabled:opacity-50"
        >
          <span aria-hidden>▶</span> Start match
        </button>
      </div>
    </div>
  );
}

function PersonBlock({
  entry,
  score,
  side,
  align = "left",
}: {
  entry: RunEntry | null;
  score: number;
  side: "A" | "B";
  align?: "left" | "right";
}) {
  const isRight = align === "right";
  return (
    <div className={isRight ? "text-right" : ""}>
      <div className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/55"
        style={{ justifyContent: isRight ? "flex-end" : "flex-start" }}>
        <span className="border border-ink/40 px-1.5 py-0.5 text-ink">{side}</span>
        <span>Chest {entry?.chest_no ?? "?"}</span>
      </div>
      <div className="mt-1 font-display text-2xl font-black leading-tight">
        {entry ? entry.name : "—"}
      </div>
      <div className="font-mono text-[11px] uppercase tracking-wide text-ink/55">
        {entry?.district ?? "—"}
      </div>
      <div className="mt-3 font-display text-5xl font-black leading-none tabular-nums">
        {score}
      </div>
    </div>
  );
}

function TableEditor({
  code,
  value,
  busy,
  onSet,
}: {
  code: string;
  value: number | null;
  busy: boolean;
  onSet: (raw: string) => void;
}) {
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  // Re-sync the input when the active category changes or a refresh brings
  // in a new server-side value. We key off both so neither change is missed.
  const lastKey = `${code}|${value ?? ""}`;
  const [seenKey, setSeenKey] = useState(lastKey);
  if (seenKey !== lastKey) {
    setSeenKey(lastKey);
    setDraft(value == null ? "" : String(value));
  }
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <label className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
        Table
      </label>
      <input
        type="number"
        min={1}
        max={999}
        inputMode="numeric"
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSet(draft);
        }}
        className="w-14 border border-ink/30 bg-paper px-1 py-0.5 text-center font-mono text-sm disabled:opacity-50"
        placeholder="–"
      />
      <button
        type="button"
        onClick={() => onSet(draft)}
        disabled={busy || draft === (value == null ? "" : String(value))}
        className="border border-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide hover:bg-ink hover:text-paper disabled:opacity-30"
      >
        {busy ? "…" : "Set"}
      </button>
      {value != null && (
        <button
          type="button"
          onClick={() => onSet("")}
          disabled={busy}
          className="border border-ink/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide hover:bg-ink hover:text-paper disabled:opacity-30"
          title="Clear table assignment"
        >
          ×
        </button>
      )}
    </div>
  );
}

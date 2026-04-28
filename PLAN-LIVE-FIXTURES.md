# PLAN — Live Fixtures Management

Source research: [research/30-live-fixtures-platforms.md](research/30-live-fixtures-platforms.md).
Companion to [PLAN-WEEK1.md](PLAN-WEEK1.md). Caveman doc — terse on purpose.

## 0. Goal

After fixtures generated for an event, operator(s) work the matches:

1. See queue of upcoming matches per category / per mat.
2. Mark a match `in_progress` (one tap) — both names + chest nos + photos shown.
3. Pick winner A or B (and game scores for best-of-3 GF) → match `completed`.
4. Bracket auto-advances winner to next slot; double-elim loser drops to LB slot.
5. Standings page computes ranks per category + medal-table per district, live.
6. Spectators see live bracket + current-match strip without auth.

Out of scope (later): video review, push-to-talk, score-by-score period events.

## 1. Hard constraints

| # | Constraint |
|---|---|
| L1 | Works on venue WiFi (slow, lossy). All operator actions go through the existing offline queue (`web/src/lib/sync/queue.ts`). |
| L2 | Every state-change recorded in `audit_log` with actor + payload. |
| L3 | Auto-advance is **idempotent** — replaying `complete` with same winner is a no-op; replaying with different winner errors unless preceded by `undo`. |
| L4 | Concurrent operators OK — two tablets on same match → server enforces `winner_entry_id is null OR equals submitted` else 409. |
| L5 | Undo allowed only if downstream slot still `scheduled` (no started match below). |
| L6 | Spectator endpoints public, cached 3-5s, no auth. |
| L7 | Bye matches (one entry only, opponent NULL) auto-complete on fixtures generate. |

## 2. Schema — migration `0030_fixture_runtime.sql`

```sql
alter table fixtures
  add column if not exists status text not null default 'scheduled'
    check (status in ('scheduled','in_progress','completed','void')),
  add column if not exists score_a smallint not null default 0,
  add column if not exists score_b smallint not null default 0,
  add column if not exists method text
    check (method in ('points','pin','disqualification','walkover','forfeit','injury') or method is null),
  add column if not exists mat_no smallint,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_by uuid references profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists fixtures_event_status_idx
  on fixtures(event_id, status, mat_no, round_no, match_no);

-- Realtime
alter publication supabase_realtime add table fixtures;
```

Backfill: existing rows with `winner_entry_id is not null` → `status='completed', completed_at=created_at`.
Existing bye rows (one entry NULL) → mark `completed` with the present entry as winner.
This is a separate `do $$ … end $$` block in the same migration.

## 3. Pure helper — `web/src/lib/fixtures/advance.ts`

```ts
export type AdvanceInput = { fixture: Fixture; winner: 'A' | 'B' };
export type AdvancePlan = {
  updates: Array<Partial<Fixture> & { id: string }>;
  byeAutoComplete?: AdvancePlan; // recursive if next slot becomes bye
};

export function planAdvance(
  fixture: Fixture,
  winner: 'A' | 'B',
  siblings: Fixture[],          // all fixtures in same category
  now: Date,
): AdvancePlan
```

Pure function. **No DB**. Returns the diff. Tested in
`advance.test.ts` (red-green-refactor — TDD skill applies):

- single-elim winner → next slot
- double-elim winner → W next slot
- double-elim loser → L drop slot via `loser_next_*`
- WB final winner → GF.A
- LB final winner → GF.B
- bye downstream → recursive plan
- already-completed → throw `AlreadyCompleted`
- conflicting winner re-submit → throw `WinnerConflict`

## 4. API surface

| Verb + path | Action | Audit action |
|---|---|---|
| `POST /api/fixtures/[id]/start` | scheduled → in_progress; stamp started_at, mat_no | `fixture.start` |
| `POST /api/fixtures/[id]/complete` | body `{ winner: 'A'|'B', score_a, score_b, method }`. Run planAdvance + apply via single RPC `apply_fixture_complete(jsonb)` for atomicity | `fixture.complete` |
| `POST /api/fixtures/[id]/undo` | revert to in_progress, NULL winner_entry_id, clear downstream slot. 409 if downstream started | `fixture.undo` |
| `POST /api/fixtures/[id]/void` | mark void (e.g. injury walkover both sides). Treats as bye for routing | `fixture.void` |
| `GET /api/fixtures?event=…&status=…&mat=…` | operator queue feed (paginated, 50) | — |

RPC `apply_fixture_complete` lives in same migration `0030`, takes
`(p_fixture_id uuid, p_winner_entry_id uuid, p_score_a int, p_score_b int, p_method text, p_actor uuid)`,
performs the diff inside a single transaction. Returns affected fixture ids.

Offline queue: extend `enqueueWeighIn` pattern → `enqueueFixtureAction({ kind, fixtureId, body })`.
4xx (except 408/429) drop, like the existing rule. Audit recorded server-side
when the queued POST eventually lands.

## 5. UI — operator side

### 5.1 Route `/admin/events/[id]/run`
Default landing for operator role on event day. Layout: 3 columns.

| Column | Content |
|---|---|
| Left | Mat strip — Mat 1, Mat 2, … each card shows current match (chest nos, names, started clock). Click → focus that mat. |
| Center | **Match runner**. Big card: A vs B, photos, district, hand. Buttons: "A wins" / "B wins". Below: best-of-3 scoreboard (only if `best_of>1`). Tap winner → confirm modal → submit. |
| Right | **Up next** queue for the focused category. Drag to reorder mat assignment. "Call to mat" button writes `mat_no`. |

Components new:
- `MatStrip.tsx` (live data via Supabase Realtime channel `fixtures:event=<id>`)
- `MatchRunner.tsx`
- `UpNextQueue.tsx`
- `BestOfScoreboard.tsx`

Keyboard: `1`=A wins, `2`=B wins, `u`=undo, `n`=next match, `m`=cycle mats.

### 5.2 Route `/admin/events/[id]/categories/[code]`
Per-category bracket grid (W / L / GF). Reuse existing
`/admin/events/[id]/print/category` server fetch (already optimised, see repo
notes 2026-04-27). Each cell is interactive: scheduled → start, in_progress →
complete, completed → undo (with confirm).

### 5.3 Route `/admin/events/[id]/standings`
Two tabs:
- **By category** — table per category: rank, name, district, chest no.
- **Medal table** — district / team summary (gold/silver/bronze counts).

Pure view from completed fixtures + helper
`web/src/lib/fixtures/standings.ts` (`computeCategoryStandings(fixtures): Standing[]`).
Tested.

## 6. UI — spectator side (public)

Route `/e/[slug]/live` (already public-token area exists for registration).
- Top: "Now on Mat 1 / 2 / …" strip (auto-refresh 5 s).
- Tabs per category — bracket SVG (read-only) + completed standings.
- Service worker caches the shell; data via `GET /api/public/fixtures?event=…`
  (anon key, RLS already public-read on `fixtures`).

No login. No realtime sub for spectators (polling is cheaper at scale).
Operators get realtime via Supabase Realtime channel.

## 7. Realtime + offline

- Subscribe pattern: `supabase.channel('fx-'+eventId).on('postgres_changes',
  { event:'*', schema:'public', table:'fixtures', filter:`event_id=eq.${id}` }, …)`.
- On change: invalidate React Query cache for that category. SWR-style.
- Offline: same `dino-sync.queue` IDB store; SyncPill already shows pending.
- Polling fallback: if realtime channel errors twice, fall back to 4-s poll
  (timer in `LiveRefresh.tsx` — extend its `tables` union to add `'fixtures'`,
  already partially wired per `LiveRefresh.tsx#L13`).

## 8. Test plan (TDD)

Unit (node:test + tsx, per `tdd/SKILL.md`):
1. `planAdvance` — table-driven, ~15 cases.
2. `computeCategoryStandings` — single-elim, double-elim, with byes, with voids.
3. `enqueueFixtureAction` — 4xx drop, 5xx retry, ordering.
4. RPC `apply_fixture_complete` — Postgres tap-style test or pgTAP-lite via
   `web/scripts/sql-test.mjs` (new) — round-trip insert → call → assert next
   slot populated.

Integration (Playwright MCP, after schema in place):
- Login as operator → run a 4-entry double-elim category end-to-end → assert
  standings page shows correct gold/silver/bronze.
- Concurrent: two tabs, both submit different winners → second gets 409.
- Undo: complete final, undo, assert downstream cleared.

## 9. Sequencing (one-PR-per-step)

1. **Migration `0030_fixture_runtime.sql`** + RPC + backfill. Apply via
   `apply_migration` MCP. Smoke `select count(*) filter (where status='completed')` matches old `where winner_entry_id is not null`.
2. **Pure helpers** `advance.ts` + `standings.ts` + tests. Red-green-refactor.
3. **API routes** `/api/fixtures/[id]/{start,complete,undo,void}` + offline-queue
   wiring. Reuse `recordAudit`.
4. **Operator console** `/admin/events/[id]/run` (3-col layout, realtime sub).
5. **Per-category bracket** interactive (reuse existing print view as base).
6. **Standings page** `/admin/events/[id]/standings`.
7. **Spectator live page** `/e/[slug]/live`.
8. **Code-reviewer pass** before sign-off (per `code-reviewer/SKILL.md`).

## 10. Open questions for user

- **Dispatch model**: do we need explicit "Mat 1 / Mat 2 / …" assignment now, or
  just a single global queue and pull-the-next? Recommend: optional `mat_no`
  column shipped, UI defaults to single-mat mode for v1.
- **Best-of-3 GF**: keep as currently flagged in `0024_fixtures_best_of`, or
  treat the GF as a single match for the regional event? Recommend: honour
  `best_of` flag — already in schema, free.
- **Method enum**: `points / pin / disqualification / walkover / forfeit /
  injury` — any others arm-wrestling-specific (e.g. `slip` after 3 fouls)? Add
  to migration if so.
- **Public live page**: spectator URL by slug or by short code? Recommend slug
  (matches existing `/e/[slug]` pattern).

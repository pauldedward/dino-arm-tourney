# Live Fixtures Management — Platform Research

Synthesised from prior research files (`archive/research/04-existing-software.json`,
`archive/research/06-personas.json`, `archive/research/10-double-elim-algo.json`)
plus targeted web searches in `30-smoothcomp.json`, `31-trackwrestling.json`,
`32-challonge.json`, `33-smoothcomp-mat.json`. Caveman tone.

## 1. Pattern survey

### Smoothcomp (BJJ / MMA — most relevant)
- **Match dispatch**: each "mat" (table) has its own queue. Next match auto-pops
  when both fighters are present + previous match closed. Mat operator screen
  shows "Now / On deck / In the hole".
- **Result entry**: side-mat tablet. Big A/B winner buttons + method (sub /
  points / DQ). One tap → match closed → bracket auto-advances both winner and,
  in double-elim, loser to predetermined slot.
- **Auto-advance**: bracket pre-built at draw time with `next_match_id` pointer
  (W) and `loser_next_match_id` (L for double-elim). Closing a match writes
  `winner_id` then walks the FK to set the slot in the next match (entry_a or
  entry_b based on parity).
- **Bye handling**: byes auto-resolved at generate-time; advance immediately.
- **Concurrency**: one mat = one row-lock. Cross-mat coordination via category
  queue. Two operators on the same match is possible — last-write-wins with an
  audit trail; Smoothcomp warns but does not block.
- **Live spectator**: cached HTML pages + 5-15s polling. No websockets in
  practice. Bracket SVG re-rendered server-side on each result.
- **Standings**: medal positions inferred from final 3 matches (W-final = gold,
  L-final = bronze, GF result = gold/silver). Computed on read, not stored.
- **Undo**: super-admin can re-open closed match; un-advances dependents
  recursively if not already started.

### Trackwrestling / FloArena (USA Wrestling)
- Same skeleton as Smoothcomp. Differences:
  - Mat assignment is manual ("send next match to Mat 3") not auto-pop.
  - Score sheet is verbose (period-by-period takedowns) — they store
    `match_events[]` not just `winner`.
  - Loser bracket drops follow USA Wrestling's specific cross-bracket pattern.
  - Live spectator uses a polling JSON endpoint, not websockets.

### Challonge / Toornament (DIY tournaments)
- Web-only. Click winner button on each match in the bracket UI. No mat queue.
- API has `PUT /matches/:id` with `winner_id` + `scores_csv`. Auto-advance is
  server-side. They store `state` enum: `pending | open | complete`.
- Concurrency: optimistic. No locking. Suitable for slow-paced events.

### BracketHQ / Tournify
- Tablet-first. One screen per mat. Big buttons, offline buffer, sync on
  reconnect. Tournify uses websockets for spectator view; BracketHQ polls.

## 2. Common data-model
| Field | Why |
|---|---|
| `status` enum: `scheduled / in_progress / completed / void` | drives UI filter, mat queue picks `scheduled` only |
| `winner_entry_id` | idempotent, single source of truth |
| `started_at`, `completed_at` | for "current match" badge + duration stats |
| `score_a`, `score_b` (best-of-N game wins) | for GF best-of-3 |
| `method` | `pin / decision / disqualification / walkover / forfeit` |
| `mat_no` (nullable) | optional dispatch — null = unscheduled in queue |
| `updated_by` (uuid) + `updated_at` | last-write-wins audit |

Auto-advance on completion: read `next_round_no, next_match_no, next_bracket_side`
and write the slot determined by parity of `match_no`. If `loser_next_*` set
(double-elim only), write loser to that slot too. Both writes inside one
transaction so failure = rollback.

## 3. Standings / rankings
- **Per category**: order = `1=GF winner, 2=GF loser, 3=L-final loser`. Single-elim:
  `1=final winner, 2=final loser, 3=both semi-final losers`. Compute as a pure
  view from completed fixtures — no separate `standings` table.
- **Across categories** (event leaderboard): tally medals by district / team;
  view: `select district, count(*) filter (where rank=1) gold, …`. Re-compute on
  every page load — cheap at our scale.

## 4. Mapping → dino-arm-tourney scope

We already have most of the schema:
- `fixtures(round_no, match_no, bracket_side, next_*, loser_next_*, best_of,
  winner_entry_id)` — covers nearly everything (see `0003`, `0022`, `0024`).
- Missing columns: `status`, `score_a`, `score_b`, `started_at`, `completed_at`,
  `method`, `mat_no`, `updated_by`, `updated_at`.
- Missing UI: operator console (mat dashboard), spectator live view, standings.
- Realtime channel already wired (`0013_realtime`, `LiveRefresh.tsx`) — re-use
  for fixtures + entries tables.
- Audit + offline queue already exist — add `fixture.complete`, `fixture.void`,
  `fixture.undo` actions; queue submit just like `enqueueWeighIn`.

Verdict: small migration (one new file) + new operator route + light spectator
route + a pure auto-advance helper is enough. No websocket infra needed —
Supabase Realtime + 5s polling fallback covers our crowd size.

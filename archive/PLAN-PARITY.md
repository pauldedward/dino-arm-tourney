# Plan — Parity with `armwrestling-registration.vercel.app` + Para + Double-Elim

> Companion to [PLAN.md](PLAN.md). Audit of the source app:
> [research/09-existing-app-audit.md](research/09-existing-app-audit.md).
>
> **Goal:** ship a strict superset of the existing TN AWA registration
> app, then layer Para arm wrestling and double-elimination bracket
> generation — the two capabilities the owner explicitly identified as
> missing.

## 0. TL;DR

The existing app is an 8-endpoint registration form + four PDF
generators. We will rebuild it as a first-class module of dino-arm-tourney
in **M0.5** (a new milestone wedged between the M0 landing and the M1
referee tooling), achieving parity in two weeks of work, then extend in
**M0.6** with Para classifications and **M0.7** with the double-elim
bracket engine. Live scoring, payments, and VAR remain on their existing
M1–M3 schedule.

## 1. Milestone insertion

```
M0   landing + schema v1            (done)
M0.5 ──► registration parity         (NEW)  — replaces the existing app
M0.6 ──► Para arm wrestling          (NEW)
M0.7 ──► double-elim bracket engine  (NEW)
M1   referee + weigh-in + payments
M2   live scoring + VAR
M3   payouts + federation portal
M4   i18n + native + ranking
```

Rationale: the owner has an **active production user base** on the
existing app. Until we match every screen they use today, we can't ask
them to switch. M0.5–M0.7 is the migration carrot.

## 2. M0.5 — Registration Parity (target: replace the live app)

### 2.1 Scope (must match existing app exactly)

- Login (username + password) and `/me` endpoint with role tiers
  (`Superadmin`, `International Referee`, `National Referee`,
  `State Referee`, `District Referee`).
- Self-register page gated by Superadmin re-verification (preserve the
  existing `/admin/register` UX).
- Event-select screen → `/register?event=<slug>`. Difference from
  source: events are **rows**, not free-text. The text box becomes a
  combobox of existing events with "+ create new" affordance.
- The full registration form (every field listed in
  [research/09-existing-app-audit.md §5.3](research/09-existing-app-audit.md)).
  Identical layout, identical button labels, identical visual polish
  (dark green / yellow accent), so muscle memory transfers.
- Registered Players sidebar with chest-no, search, refresh, edit,
  delete, clear-all.
- Edit Player modal — identical fields and tab order.
- Post-Processing modal with the four PDFs (Nominal, Category, ID Cards,
  Pending Dues). Same labels, same outputs (we can A/B the PDFs against
  the live ones).
- Photo upload pipeline (Supabase Storage instead of bespoke
  `/api/upload`).

### 2.2 Things we deliberately upgrade in M0.5

| Existing | Upgrade | Why |
|---|---|---|
| Free-text event names | Events table with slug + dates + venue | Renaming no longer drops history (G5) |
| `?username=` query as tenant | `tenant_org_id` from session | Closes IDOR (§9 of audit) |
| Edits overwrite | Append-only `event_log` rows (PLAN.md §12) | Audit trail (G10) |
| Hard-coded districts | `districts` reference table seeded from existing list | Add missing districts (Thoothukudi, Thiruvarur, Kanyakumari) |
| Manual `amount_paid` typing | Manual entry **kept** + Razorpay link "Send payment link" button (Razorpay actual collection lands in M1) | Bridge, no regression |
| No forgot-password | Email/SMS OTP reset | G14 |

### 2.3 Out of scope for M0.5 (deferred)

- Live scoring, weigh-in, brackets, payments, VAR, streaming. M0.5 is
  registration parity only.

### 2.4 Schema delta from `0001_init.sql`

A migration `0003_registration_parity.sql` will:

1. Add `display_chest_no INT` to `entries` (auto-increment from 1001
   per event for continuity with printed badges).
2. Add `youth_hand`, `senior_hand` columns where missing — the source
   app captures hands per age band, not per entry.
3. Replace single `gender ENUM` with `division ENUM('Men','Women','Para
   Men','Para Women')` *(executed in M0.6 migration)*.
4. Seed `districts` table with the 33 TN districts from
   [research/09-existing-app-audit.md §4](research/09-existing-app-audit.md).
5. Seed `roles` table with `Superadmin`, `International Referee`,
   `National Referee`, `State Referee`, `District Referee`.

### 2.5 PDF generators (the killer feature of the existing app)

Implemented as Edge Functions returning `application/pdf` using
`@react-pdf/renderer`:

- `POST /api/post-processing/nominal` — alphabetical roster.
- `POST /api/post-processing/category` — grouped (division × age ×
  weight × hand). With Para added, this is the report that exposes
  whether a category has enough entries to run.
- `POST /api/post-processing/id-card` — A4 sheet of 8 chest-number
  badges with photo + QR (QR resolves to athlete public profile).
- `POST /api/post-processing/pending-dues` — outstanding amounts table
  + total, with "Send payment link" bulk action.

We test each PDF against a sample export from the live app to confirm
visual parity.

### 2.6 M0.5 acceptance test

> A TN AWA district secretary, given the URL of our new app and their
> existing username, can register 50 athletes for a district event and
> print all four PDFs in under 30 minutes, without once saying "where's
> the X button?".

## 3. M0.6 — Para arm wrestling (the first owner ask)

### 3.1 Schema

```sql
ALTER TYPE division_enum ADD VALUE 'Para Men';
ALTER TYPE division_enum ADD VALUE 'Para Women';

ALTER TABLE entries
  ADD COLUMN para_class TEXT
    CHECK (para_class IN ('PD1','PD2','PS1','PS2','PS3','B1','B2','B3')),
  ADD COLUMN seated_or_standing TEXT
    CHECK (seated_or_standing IN ('Standing','Seated','Either')),
  ADD COLUMN mobility_aid TEXT,
  ADD COLUMN classifier_user_id UUID REFERENCES users(id),
  ADD COLUMN classified_at TIMESTAMPTZ;
```

Para weight classes are wider than able-bodied; stored as a separate
`weight_class` row in the `rule_profile` so the `category` resolver
picks them up automatically.

### 3.2 UI changes

- Gender selector grows from **2 buttons** to **4** (Men / Women /
  Para Men / Para Women).
- Selecting Para reveals a **Classification** sub-form:
  - Standing vs Seated radio.
  - Para class dropdown (PD1/PD2/PS1/PS2/PS3/B1/B2/B3) with one-line
    explainer on hover.
  - Mobility aid free-text (optional).
  - Classifier name (must be a logged-in user with rank ≥ National
    Referee; recorded as `classifier_user_id`).
- Para entries show a **Para badge** in the Registered Players sidebar.
- Category PDF gains a Para section.

### 3.3 Bracket implication

Para brackets are **single-arm** — the athlete declares one hand and
that's the only bracket they enter. No youth/senior split for hand
selection in the Para branch. Captured by hiding the Senior/Youth Hand
toggles when division is Para and replacing them with one "Competing
arm" Right/Left selector.

### 3.4 M0.6 acceptance test

> A Para athlete with PS2 classification, competing in left arm at 75
> kg, can be registered, appears in the Category PDF under
> "Para Men – PS2 – Seated – -80kg – Left", and is correctly excluded
> from the able-bodied bracket of the same weight.

## 4. M0.7 — Double-elimination bracket engine

### 4.1 Why this is owner ask #2

Single-elim is what casual events use; every WAF/IAFF/PPL event that
matters runs **double-elim with a true final**. The existing app has
**no bracket page at all** — even single-elim. We are skipping
single-elim-only mode and going straight to double-elim with a flag to
collapse it into single-elim when the organiser wants.

### 4.2 Algorithm (implementation-ready)

Inputs to `generateBracket(entries, opts)`:

```ts
type Entry  = { id: string, seed?: number };
type Opts   = {
  format: 'DOUBLE_ELIM' | 'SINGLE_ELIM';
  bracketReset: boolean;   // grand-final reset on LB-winner W; default true
  seedingMode: 'RANKED' | 'RANDOM' | 'SNAKE_BY_DISTRICT';
};
```

Algorithm (double-elim case):

1. **Auto-medal short cases.**
   - `n == 1` → gold to the lone entrant; bracket has zero matches.
   - `n == 2` → best-of-three series in WB final position; no LB.
2. **Pad to next power of two `p = 2^⌈log₂ n⌉`.** Generate `p − n` byes.
3. **Seed.** RANKED uses ranking points; RANDOM uses crypto RNG;
   SNAKE_BY_DISTRICT spreads same-district athletes into different
   quarters (TN AWA convention to delay district derbies).
4. **Place with standard seeding pattern.** Slot 1 vs slot p, slot 2
   vs slot p−1, … on outer boundaries; recursively quarter the bracket
   so seeds 1..4 cannot meet before semis.
5. **Generate WB.** `log₂(p)` rounds. Byes auto-advance.
6. **Generate LB skeleton.** `2·log₂(p) − 1` rounds. Maintain a
   `loserDestination[wbRound][matchIndex] = (lbRound, lbMatchIndex,
   lbSlot)` lookup. The classic placement table:
   - WB-R1 losers fill LB-R1 in order.
   - WB-R2 losers fill LB-R2; routing inverts every other round to
     avoid first-round LB rematches.
   - WB final loser drops into LB final.
7. **Grand Final.**
   - GF1: WB-winner vs LB-winner.
   - If `bracketReset` and LB-winner wins GF1, append GF2.
8. Persist as `match` rows in event order (`order_index`); each match
   carries `next_match_win_id`, `next_match_loss_id`, `is_grand_final`,
   `is_bracket_reset`.

### 4.3 Live updates

When a match's winner is recorded (M2 referee tablet writes the
`match.completed` event), a Postgres trigger fans the winner into the
next WB slot and the loser into the LB slot from the lookup table —
both writes happen in the same transaction so the bracket can never be
half-updated.

### 4.4 UI

- Bracket page `/e/<slug>/bracket/<categoryId>` — SVG render with
  zoom, pan, and "follow athlete" highlight.
- WB on top, LB on bottom, GF in the middle column. Standard layout,
  no innovation needed.
- Per-hand: dropdown switches between R/L brackets within the same
  weight class.
- Public read-only at `/e/<slug>/bracket/<categoryId>`; organiser-only
  draw controls behind auth.

### 4.5 PDF output

Two new exports added to the Post-Processing modal:

- "Print Bracket (Double Elim)" — landscape A3, one bracket per page.
- "Print Order of Play" — call-order list for the MC, grouped by table.

### 4.6 M0.7 acceptance test

> Given 13 athletes in Men Senior 80kg Right Arm, the engine produces
> a double-elim with 16 slots (3 byes given to seeds 1, 2, 3),
> 4 WB rounds, 7 LB rounds, and a grand final with reset enabled.
> Recording each verdict on the referee tablet (mocked) advances both
> brackets correctly to a single champion. The "follow athlete" view
> shows seed #4's full path through both brackets.

## 5. Cross-cutting changes triggered by these three milestones

- **`rule_profile` seed** must include the TN AWA profile (8 age
  bands, the existing weight bucketing logic for Youth and Senior,
  and the Para weight classes). This is the first real exercise of
  PLAN.md's "rules are data" principle.
- **`event_log` from day one** — every registration, edit, delete,
  and bracket draw is a signed row (PLAN.md §12). The existing app
  silently overwrites; we will not.
- **District list reconciliation** with TN AWA — confirm the missing
  4 districts before seeding.
- **Tamil i18n strings** for the four PDFs ship in M0.5 even though
  full UI translation lands in M4 — the printed material is what
  district secretaries hand to non-English-speaking athletes.

## 6. Risks specific to this plan

| # | Risk | Mitigation |
|---|---|---|
| R1 | Owner's user base resists migrating until our app *exactly* matches the existing one | M0.5 acceptance test is "0 'where's X' questions". Run it with a real district secretary before declaring done. |
| R2 | Para classification is contested (an athlete may not have an official IPC class) | Allow `para_class = 'PROVISIONAL'` flag with classifier name + signature; final class set later by federation. |
| R3 | Double-elim placement table bugs are easy to introduce and hard to spot until live | Property-test against a corpus of known-good brackets (Challonge exports) for n = 3..64. CI fails if any mismatch. |
| R4 | The existing `?username=` IDOR may already have leaked rosters | Out of scope for our app, but flag to owner; do not import the bug. |
| R5 | Existing chest-number range (1001+) collides with our `entries.id` UUIDs in printed material | Keep `display_chest_no` as a separate per-event sequence; UUID is internal. |

## 7. What stays unchanged from PLAN.md

Everything in PLAN.md §11 (multi-hub mesh), §12 (signed event log),
§3 (lifecycle), and the M1–M4 milestone list remains the source of
truth for everything beyond registration + Para + double-elim. M0.5–M0.7
is **insertion**, not replacement.

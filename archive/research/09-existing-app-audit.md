# Audit — `armwrestling-registration.vercel.app`

> Date: 2026-04-21. Auditor: dino-arm-tourney team. Authorized by owner.
> Logged in as `_kevin.s_` (rank: International Referee, `isSuperadmin:false`,
> id 3). Superadmin endpoints not bypassed — gated by separate
> `/admin/register` "Superadmin Verification" form (username + password) used
> to mint new referee accounts. We respected the gate.

## 1. Stack (observed)

- **Frontend:** Next.js 15 App Router + Turbopack (chunk hashes
  `1d4066…`, `67721b…`, `73fbbb…`, etc.), Tailwind, framer-motion
  animations on the navbar.
- **Hosting:** Vercel (`armwrestling-registration.vercel.app`).
- **Auth:** Cookie session (no JWT in URL). `POST /api/login` sets
  cookie; `GET /api/me` returns `{loggedIn, user:{id, username,
  isSuperadmin, rank}}`.
- **Storage:** Photo upload via `POST /api/upload` (returns URL string
  used in athlete record). Backend likely Postgres (numeric incrementing
  chest numbers starting at 1001) — not directly observed.

## 2. Sitemap

| Route | Auth | Purpose |
|---|---|---|
| `/` | public | Marketing landing — "Strength • Passion • Glory", three pillars (Recognition / Standards / Development), "Register Now" CTA |
| `/login` | public | Username + password login |
| `/admin/register` | Superadmin gate | Create new referee/admin accounts (Superadmin must enter creds) |
| `/event-select` | logged-in | Free-text "Event name" → routes to `/register?event=<name>` |
| `/register?event=<slug>` | logged-in | Single-page event registration UI + Post-Processing modal |

That is the entire sitemap. There is **no** bracket page, no live-scoring
page, no weigh-in page, no public results page, no athlete dashboard,
no payment screen, no federation portal.

## 3. API surface (complete — extracted from JS bundles)

```
POST /api/login
POST /api/logout
GET  /api/me
GET  /api/athletes?username=<u>
POST /api/athletes
GET  /api/athletes/[id]
PUT  /api/athletes/[id]
DELETE /api/athletes/[id]
POST /api/upload                       (multipart, returns photo URL)
POST /api/post-processing/nominal      (PDF: nominal list)
POST /api/post-processing/category     (PDF: category-wise list)
POST /api/post-processing/id-card      (PDF: chest-no ID cards)
POST /api/post-processing/pending-dues (PDF: payment report)
```

Eight resource endpoints. That is the whole product surface.

## 4. Data model (inferred from form + observed records)

### `users`
```
id            int  (3 = _kevin.s_)
username      text (note: literal underscores allowed)
password_hash text
isSuperadmin  bool
rank          text  enum-ish: 'Superadmin' | 'International Referee' | …
```

### `athletes`  (one row per registration per event)
```
id              int  (chest_no, starts 1001)
event           text (free-text — no separate events table)
created_by      text (username — used as soft tenant key)
initial         text  ("M" in "M. PRASANTH")
full_name       text
team_or_district enum('Team','District')
district        text  (one of 33 TN districts; null if Team mode)
team            text  (null if District mode)
dob             date
mobile          text  ('+91' fixed prefix)
aadhaar         text
gender          enum('Men','Women')                     -- only 2 options
age_categories  text[]  multi-select of 8 age bands
youth_hand      enum('Right','Left','Both')  nullable
senior_hand     enum('Right','Left','Both')  nullable
weight_kg       numeric
photo_url       text
amount_paid     numeric
amount_pending  numeric
```

### Reference lists (hard-coded in frontend, not API-driven)
- **Districts** (33): ARIYALUR, CHENGALPATTU, CHENNAI, COIMBATORE,
  CUDDALORE, DHARMAPURI, DINDIGUL, ERODE, KALLAKURICHI, KANCHIPURAM,
  KARUR, KRISHNAGIRI, MADURAI, MAYILADUTHURAI, NAGAPATTINAM, NAMAKKAL,
  NILGIRIS, PERAMBALUR, PUDUKKOTTAI, RAMANATHAPURAM, RANIPET, SALEM,
  SIVAGANGAI, TENKASI, THANJAVUR, THENI, TIRUNELVELI, TIRUPATTUR,
  TIRUPPUR, TIRUVALLUR, TIRUVANNAMALAI, VELLORE, VILLUPURAM,
  VIRUDHUNAGAR. (Missing from list: THOOTHUKUDI, THIRUVARUR, KANYAKUMARI,
  CHENNAI suburbs — verify with TN AWA.)
- **Age categories** (8): Sub Junior, Junior, Youth, Senior, Master,
  Grand Master, Senior Grand Master, Super Senior Grand Master.
- **Gender** (2): Men, Women. **No Para track.**
- **Hand** (3): Right, Left, Both — captured separately for Youth and
  Senior bands.
- **Roles**: Superadmin, International Referee (likely also National /
  State / District tiers but only "Superadmin" and "International
  Referee" actually appear as string literals in the bundle).

## 5. Feature inventory (what the app actually does)

### 5.1 Auth & roles
- Username + password login. Logout button in side drawer.
- "Forgot password?" button (no flow observed — likely TODO).
- Self-register link → Superadmin must approve by entering Superadmin
  credentials on `/admin/register`.

### 5.2 Event handling
- **Event = free-text string.** No events table, no schedule, no venue,
  no dates, no sanctioning. Whoever types `TN STATE CHAMPIONSHIP - 2026`
  first owns the spelling.
- "Edit Event" button on the registration page renames the event
  string in-place.

### 5.3 Athlete registration (the entire product)
- Initial + Full Name (two fields, dot rendered between).
- Team / District radio toggle.
- District combobox (33 TN districts) **or** Team free-text.
- DOB (DD/MM/YYYY).
- Mobile (+91 fixed).
- Aadhaar.
- Gender (Men / Women).
- Age category — eight buttons, multi-select observed in edit modal
  (athlete can be in Youth + Senior at once → two hand selectors).
- Per-band hand: Youth Hand R/L/Both, Senior Hand R/L/Both.
- Weight (kg). On entry, UI shows derived band per age category
  ("Youth: 70 KG", "Senior: 70 KG") — bucketing logic is client-side.
- Photo upload (via `/api/upload`).
- Amount Paid / Amount Pending (manual rupee entry — no gateway).
- Registered Players sidebar: chest-no list (1001+), search box,
  Refresh, Clear All, Edit, Delete.

### 5.4 Post-processing (PDFs)
Modal with four buttons:
1. **Nominal List** — alphabetical roster.
2. **Category List** — grouped by gender × age × weight.
3. **ID Cards** — printable chest-number badges with photo.
4. **Pending Dues** — payment report (uses `amount_paid`/`pending`).

PDFs are generated server-side (the POST returns a binary; the UI
triggers a download).

## 6. What is NOT in the existing app (gap inventory)

| # | Missing capability | Severity |
|---|---|---|
| **G1** | **Para arm wrestling category** (gender enum is Men/Women only; no impairment class, no seated-vs-standing split) | **Blocking** for owner |
| **G2** | **Bracket / draw generation** (single OR double elimination) — no bracket page exists at all | **Blocking** for owner |
| **G3** | Live match scoring / referee app | High |
| **G4** | Weigh-in workflow with scale photo evidence + window | High |
| **G5** | Real events table — name, venue, dates, sanction body, status | High |
| **G6** | Online entry payment (Razorpay / UPI). Today fees are typed by hand. | High |
| **G7** | Public spectator pages (live brackets, results) | High |
| **G8** | Athlete-facing self-service (their own profile, registration, draw, slot) | Medium |
| **G9** | Federation/Organizer multi-tenancy. Today `username` is the soft tenant key in the URL. | Medium |
| **G10** | Audit trail / event log. Edits and deletes silently overwrite. | High (compliance) |
| **G11** | Video review (3rd referee VAR) | Medium |
| **G12** | Bilingual UI (Tamil) | Medium |
| **G13** | Offline-tolerant operation — entirely Vercel-hosted, dies with WAN | High |
| **G14** | Forgot-password flow | Low |
| **G15** | Aadhaar / PAN verification, medical waiver e-sign, insurance upload | Medium |
| **G16** | Ranking points engine (WAF 10-7-5-4-3-2-1) | Medium |
| **G17** | Razorpay Payouts + 194B TDS + Form 16A on prizes | Medium |
| **G18** | Live streaming / overlays | Low (later) |
| **G19** | Coach team batch upload | Medium |
| **G20** | Hand-specific bracket execution (R / L are separate competitions, but the app only records the entry — not the draw per hand) | High |

## 7. Things to keep / copy from existing app

- **The 8 age categories** (matches IAFF naming; we should use the
  same labels so referees don't relearn vocabulary).
- **The 33 TN district list** (use as seed `districts` table).
- **The chest-number scheme** starting at 1001 (good operator UX).
- **The four post-processing PDFs** — every TN organiser already prints
  these; we must ship them on day one.
- **Per-hand registration with separate Youth/Senior hand selectors.**
  This is correct domain modelling — many athletes only compete one
  hand and only in one age band. We currently model it differently in
  `0001_init.sql` and need to align.
- **The simple, mobile-friendly visual language** (dark green/black,
  yellow accent, big tap targets). The existing UI is genuinely usable
  on a phone at a venue; we should not regress on that.

## 8. Things that must change (architectural)

- Event must be a **first-class row**, not a free-text string. Renaming
  drops history.
- Edits must append, not overwrite (PLAN.md §12 event log).
- Tenant key must be the federation/organiser id, not `username` in a
  query string.
- Reference data (districts, age bands, weight classes) must be a
  `rule_profile` row, not hard-coded in the bundle (PLAN.md §1.3.5
  "rules are data").
- Gender enum must become `(division, sub_division)` — see §10 below.

## 9. Security observations

- `GET /api/athletes?username=<u>` accepts the username as a *query
  string*, not from the session. We did not test, but this looks
  vulnerable to IDOR — any logged-in referee can probably read another
  referee's roster by changing the query param. **Do NOT replicate this
  pattern.**
- `/admin/register` has Superadmin re-verification, which is good.
- Cookie attributes not inspected; assume HttpOnly+Secure in our
  rebuild regardless.

## 10. Para arm wrestling — domain notes (for §G1 fix)

WAF and IPC (International Paralympic Committee) recognise para arm
wrestling with these splits:

- **Standing classes:** PD1 (lower-limb impairment, can stand with or
  without prosthesis), PD2 (cerebral palsy / coordination, ambulant).
- **Seated classes:** PS1 (wheelchair, full trunk control), PS2
  (wheelchair, limited trunk control), PS3 (severe impairment).
- **Visually impaired:** B1 / B2 / B3.

Para events run **single-arm only** (athlete declares which arm; both
arms are separate events), and weight classes are typically wider
(e.g., −70 kg, −80 kg, +80 kg for Men) to ensure viable brackets given
smaller athlete pools.

Implication for our schema:

```
division        enum('Men','Women','Para Men','Para Women')
para_class      text   nullable  -- PD1 | PD2 | PS1 | PS2 | PS3 | B1..B3
seated_or_standing enum('Standing','Seated','Either') nullable
mobility_aid    text   nullable  -- 'wheelchair', 'prosthesis', etc.
```

A Para athlete still maps to the same age categories and weight bucketing.

## 11. Double elimination — domain notes (for §G2 fix)

WAF, IAFF, and most pro events run **double elimination with a true
final** (sometimes called "true double" or "King's bracket"):

- Athletes sit in a **Winners' Bracket (WB)** until they lose once.
- A first loss drops them to the **Losers' Bracket (LB)**.
- LB winner faces WB winner in the **Grand Final**. If LB winner wins
  Round 1 of the Grand Final, a **second decisive match** is played
  (the WB winner has not yet lost).
- Per-hand: Right and Left arm are **separate independent brackets**
  even within the same weight class.

Generation algorithm we'll implement:

1. Take the `n` registered athletes in a (gender, age, weight, hand)
   bucket. If `n == 1`, auto-medal. If `n == 2`, best-of-three. If
   `n >= 3`, build double elim.
2. Compute the next power of two `p = 2^ceil(log2(n))`.
3. Seed athletes 1..n by ranking points (or random for unranked) using
   the standard seeding pattern (1 vs p, 2 vs p−1, …).
4. Insert `p − n` byes in seed-order so top seeds get the byes.
5. Generate WB rounds. As losses occur, route each loser to the
   correct LB slot using the standard Loser Bracket placement matrix
   (the routing differs by round to avoid immediate rematches).
6. LB has `2·log2(p) − 1` rounds (LB drop rounds + LB-only rounds).
7. Grand Final = WB-winner vs LB-winner; bracket reset on first loss.

Reference implementation lives in PLAN.md §6 (bracket engine). The
existing app **has none of this**.

## 12. Recommended migration path for existing data

Once the owner exports their TN AWA athlete table, we can map it 1-to-1
into our schema with these adjustments:

| Existing field | New field(s) |
|---|---|
| `event` (text) | `event_id` (FK) — bulk-create event rows from distinct strings |
| `gender` ('Men'/'Women') | `division` ('Men'/'Women'/'Para Men'/'Para Women') |
| `age_categories[]` + `youth_hand`/`senior_hand` | one `entry` row per (athlete, age, hand) — explodes 1 athlete row into 1..4 entry rows |
| `team_or_district` + `district`/`team` | `affiliation_kind` + `affiliation_id` |
| `amount_paid`/`amount_pending` | `entry_fee_paise` + Razorpay `payment_id` (nullable for legacy) |
| `created_by` (username) | `created_by_user_id` + `tenant_org_id` |

Chest numbers are preserved as `display_chest_no` for continuity with
printed material.

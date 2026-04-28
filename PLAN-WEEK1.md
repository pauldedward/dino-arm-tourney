# Plan — Week 1 (v3.1): Tamil Nadu State Arm Wrestling Championship

> v3.1 = v3 with two targeted changes:
> 1. **Double-elimination is the default bracket format** (configurable per event).
> 2. **No WAF/IAFF rule-set selection field** on the event — categories, age bands, and
>    weight classes remain as plain config constants in `web/src/lib/rules/`, but no
>    "rulebook version" metadata is stored or selected in the UI.
>
> Everything else from v3 is retained. Companion to [archive/PLAN.md](archive/PLAN.md)
> and [archive/PLAN-PARITY.md](archive/PLAN-PARITY.md).

## 0. Hard constraints

| # | Constraint |
|---|---|
| C1 | **Online registration**, athletes register from all over TN before match day. |
| C2 | **₹0 platform spend.** Per-transaction 2% on a real gateway is acceptable as a *future* toggle, not a week-1 dependency. |
| C3 | **Match day works on venue WiFi**; cloud sync resumes when WAN returns. |
| C4 | **Super admin can publish + close registration**. |
| C5 | **Multiple operators with login**, every important action logged with actor id. |
| C6 | **All ID-card content (logo, colours, org name, event title, signatory, etc.) is per-event** and editable from the super-admin UI — no globals, no redeploy for a re-brand. |
| C7 | **≤ 2000 athletes** total. |
| C8 | **7 days** to delivery. |
| C9 | **Super admin can create events**, publish/close registration, view all registrations across events. |
| C10 | **Super admin can invite operators by email**, change roles, promote to super admin. |
| C11 | **Sample-data seeding from JSON fixtures into the real DB** for development/demo. JSON is *not* the runtime store. |
| C12 | **Brackets are double-elimination by default.** Single-elim is a per-event toggle. |

## 1. Architecture

### 1.1 Stack (final)

| Concern | Service | Tier | Notes |
|---|---|---|---|
| App runtime | Next.js 16 on Vercel (or self-host) | Hobby (free) | Already in repo |
| Database | **Supabase Postgres** | Free (500 MB) | ~35 MB used → 7% (§1.4) |
| Auth | **Supabase Auth** | Free (50k MAU) | Operators only; athletes don't log in |
| Realtime (optional) | Supabase Realtime | Free | Used in stretch §6 |
| **Media (photos, UPI proofs, logos)** | **Cloudflare R2** | **10 GB free + zero egress fees, ever** | S3-compatible API |
| PDFs | `@react-pdf/renderer` | — | Generated on demand, never stored |
| Background images on venue laptop | local `web/public/cached/` | — | Pre-cached morning of |

### 1.2 Why Supabase + Cloudflare R2 (not just Supabase)

The Supabase free tier caps egress at **5 GB/month**. With 2000
athletes, photos served to operator dashboards plus signed URLs for
ID-card PDFs can plausibly hit that ceiling mid-month and start
returning 5xx mid-event. We don't accept that risk for ₹0 when R2
exists:

- **R2: 10 GB free storage, $0 egress, no per-request fee for the
  free tier's 1M class-A and 10M class-B operations/month.**
- S3-compatible API → `@aws-sdk/client-s3` works unchanged.
- Public-bucket mode for logos, presigned URLs for athlete photos and
  payment screenshots.

Database, auth, and RLS stay on Supabase — they're worth the friction.
Media moves to R2 because storage + egress is the only real risk.

### 1.3 Cloud-primary + Offline-Queue

Bidirectional local↔cloud DB sync is **not** built — too expensive for
the benefit at our scale. Instead:

```
                  ┌──────────────────────┐
   public web     │   Supabase (cloud)   │ ← single source of truth
  registration    │   Postgres + Auth    │
       │          └─────────┬────────────┘
       │                    │ HTTPS
       │          ┌─────────┴────────────┐
       │          │   Cloudflare R2      │ ← photos, screenshots, logos
       │          │   (zero egress)      │
       │          └─────────┬────────────┘
       │                    │
       ▼          ┌─────────┴────────────┐
                  │   Venue laptop:      │
                  │   Next.js on 0.0.0.0 │
                  │   + IndexedDB queue  │
                  │     for weigh-in     │
                  │   + ./cached/photos  │
                  └─────────┬────────────┘
                  LAN WiFi  │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
           tablet 1     tablet 2       phone 3
           operator    weigh-in      reg desk
```

Only **two** flows queue offline: **weigh-in confirm** and
**payment verify**. Reads use stale-while-revalidate from a local
cache. On replay, local writes win unconditionally for the columns
they touch. Every write carries `actor_id` so the audit log shows
who clobbered what.

### 1.4 Storage budget (verified)

#### Database (Supabase free 500 MB)

| Table | Rows | ~B/row | Total |
|---|---|---|---|
| `registrations` (denormalised, ~30 cols) | 2,000 | 1.5 KB | 3 MB |
| `entries` | 3,000 | 0.3 KB | 1 MB |
| `payments` | 2,000 | 0.5 KB | 1 MB |
| `weigh_ins` (with reweighs) | 2,500 | 0.3 KB | 1 MB |
| `fixtures` (double-elim ≈ 2·N) | 5,600 | 0.25 KB | 1.5 MB |
| `audit_log` (~20/athlete) | 40,000 | 0.5 KB | 20 MB |
| Indexes (+30%) | | | 8 MB |
| **Total** | | | **~35 MB / 500 MB** (7%) |

#### Media (Cloudflare R2 free 10 GB)

| Asset | Compressed target | × 2000 | Total |
|---|---|---|---|
| Registration photo (resized 600×800, JPEG q=75) | 80 KB | | 160 MB |
| Weigh-in live photo | 60 KB | | 120 MB |
| UPI payment screenshot (resized 1080w, JPEG q=70) | 120 KB | | 240 MB |
| Per-event logo + banner | ~500 KB | × few | 5 MB |
| **Total** | | | **~525 MB / 10 GB** (5%) |

#### Egress

R2 = **0 GB used** by design. Supabase egress is now only used for
DB query traffic, which for our row counts is negligible (~100 MB/month
worst case).

#### PDFs

Generated on demand in the browser/Next.js handler, streamed to the
client, never stored. **0 bytes** persistent storage.

### 1.5 Discipline rules (mandatory, not optional)

These three rules make the whole budget work and are baked into the
endpoints, not "remember to do this":

1. **Upload-time image compression.** Every image upload route
   (registration photo, weigh-in photo, UPI screenshot) runs the file
   through `sharp` server-side: max 1080w, JPEG q=75, EXIF stripped.
   Reject result if > 500 KB after compression. Refuse formats other
   than JPEG/PNG/WebP/HEIC.
2. **Match-day photo pre-cache** is part of the dress-rehearsal
   checklist (Day 6), not "consider doing this". The venue laptop
   pulls every photo from R2 to `web/public/cached/<id>.jpg` once;
   all on-LAN photo fetches go to the laptop after that.
3. **No photos on the public thank-you page.** The athlete's own
   thank-you page shows chest-no, payment QR, and status text only.
   Saves R2 class-B operations and removes a re-fetch loop on phone
   refresh.

### 1.6 Fallback option (if Vercel/Supabase egress ever bites)

If the org's home internet is reliable and you'd rather own the
hardware: run the same Next.js + local Postgres on the venue/office
laptop, expose it publicly via **Cloudflare Tunnel** (free, valid TLS,
no port-forwarding). Inverts the architecture — laptop is the cloud.
No quotas at all. Documented as fallback only; the plan ships on
Option B (Supabase + R2).

## 2. Payment

### 2.1 Default: manual UPI + proof upload (₹0 gateway cost)

Public registration form shows a static UPI QR (the org's UPI id, e.g.
`tnawa@okhdfc`) with the amount due. After paying the athlete enters:

1. **UTR / reference number** (12 digits).
2. **Screenshot/photo** of the payment confirmation → R2.

Status starts at `payment_pending`. An operator opens the entry,
checks the UTR matches their bank statement, taps **MARK VERIFIED**.
Logged as an `audit_log` row with the operator's id.

UPI P2M is 0% MDR by RBI mandate — the org pays nothing.

### 2.2 Optional: Razorpay Standard Checkout

Built behind `event.payment_provider = 'manual_upi' | 'razorpay'`.
Coded but disabled this week. Stretch §6.1.

## 3. Schema

Builds on `supabase/migrations/0001_init.sql`. New migration
`0003_week1.sql` with no destructive changes.

```sql
-- 3.1 Roles ----------------------------------------------------------
alter table profiles
  drop constraint if exists profiles_role_check,
  add constraint profiles_role_check
    check (role in ('athlete','operator','weigh_in_official',
                    'super_admin','federation_admin','referee',
                    'medical','accounts','organiser'));
alter table profiles
  add column if not exists email         text,
  add column if not exists invited_by    uuid references profiles(id),
  add column if not exists invited_at    timestamptz,
  add column if not exists disabled_at   timestamptz,
  add column if not exists last_seen_at  timestamptz;

-- 3.2 Events (publish/close, branding, full ID-card content) --------
-- NOTE: no rule-set selector. Category/age/weight lookups live in
-- web/src/lib/rules/ and apply uniformly to every event.
alter table events
  add column if not exists registration_published_at timestamptz,
  add column if not exists registration_closed_at  timestamptz,
  add column if not exists payment_provider        text not null default 'manual_upi'
    check (payment_provider in ('manual_upi','razorpay','none')),
  add column if not exists upi_id                  text,
  add column if not exists upi_payee_name          text,
  add column if not exists entry_fee_default_inr   int default 500,
  add column if not exists fee_overrides           jsonb default '{}'::jsonb,
  add column if not exists bracket_format          text not null default 'double_elim'
    check (bracket_format in ('double_elim','single_elim')),
  -- Branding
  add column if not exists logo_url                text,           -- R2 public URL
  add column if not exists banner_url              text,
  add column if not exists primary_color           text default '#0f3d2e',
  add column if not exists accent_color            text default '#f5c518',
  add column if not exists text_on_primary         text default '#ffffff',
  add column if not exists id_card_template        text default 'tnawa_v1',
  -- ID-card content (all per-event)
  add column if not exists id_card_org_name        text,
  add column if not exists id_card_event_title     text,
  add column if not exists id_card_subtitle        text,
  add column if not exists id_card_footer          text,
  add column if not exists id_card_signatory_name  text,
  add column if not exists id_card_signatory_title text,
  add column if not exists id_card_signature_url   text;            -- R2

-- A registration form is open when:
--   registration_published_at IS NOT NULL
--   AND (registration_closed_at IS NULL OR registration_closed_at > now())

-- 3.3 Para arm wrestling --------------------------------------------
alter table athletes
  add column if not exists is_para        boolean not null default false,
  add column if not exists para_class     text
    check (para_class in ('PD1','PD2','PS1','PS2','PS3','B1','B2','B3')),
  add column if not exists para_posture   text
    check (para_posture in ('Standing','Seated'));

-- 3.4 Registration --------------------------------------------------
alter table registrations
  add column if not exists chest_no           int,
  add column if not exists initial            text,
  add column if not exists full_name          text,
  add column if not exists dob                date,
  add column if not exists division           text
    check (division in ('Men','Women','Para Men','Para Women')),
  add column if not exists affiliation_kind   text
    check (affiliation_kind in ('District','Team')),
  add column if not exists district           text,
  add column if not exists team               text,
  add column if not exists mobile             text,
  add column if not exists aadhaar_masked     text,
  add column if not exists declared_weight_kg numeric(5,2),
  add column if not exists age_categories     text[],
  add column if not exists youth_hand         text check (youth_hand in ('R','L','B')),
  add column if not exists senior_hand        text check (senior_hand in ('R','L','B')),
  add column if not exists photo_url          text,                -- R2
  add column if not exists photo_bytes        int,
  add column if not exists submitted_by       text default 'self';

-- 3.5 Payments ------------------------------------------------------
create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  amount_inr      int not null,
  method          text not null check (method in ('manual_upi','razorpay','cash','waiver')),
  utr             text,
  proof_url       text,                                            -- R2 (private, signed URL)
  status          text not null default 'pending'
                  check (status in ('pending','verified','rejected')),
  verified_by     uuid references profiles(id),
  verified_at     timestamptz,
  notes           text,
  created_at      timestamptz default now()
);

-- 3.6 Weigh-ins (append-only) ---------------------------------------
create table if not exists weigh_ins (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  measured_kg     numeric(5,2) not null,
  live_photo_url  text,                                            -- R2
  scale_photo_url text,                                            -- R2 (optional)
  weighed_by      uuid references profiles(id),
  weighed_at      timestamptz default now()
);

-- 3.7 Audit log -----------------------------------------------------
create table if not exists audit_log (
  id              bigserial primary key,
  event_id        uuid references events(id),
  actor_id        uuid references profiles(id),
  actor_label     text,
  action          text not null,
  target_table    text,
  target_id       text,
  payload         jsonb,
  client_ip       text,
  created_at      timestamptz default now()
);
create index if not exists audit_log_event_idx on audit_log(event_id, created_at desc);
create index if not exists audit_log_actor_idx on audit_log(actor_id, created_at desc);

-- 3.8 Entries + fixtures (double-elim by default) ------------------
create table if not exists entries (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  division        text not null,
  age_band        text not null,
  weight_class    text not null,
  hand            text not null check (hand in ('R','L')),
  category_code   text not null,
  seed            int,
  unique (registration_id, division, age_band, weight_class, hand)
);

-- Double-elim fixture shape:
-- bracket: 'W' (winners), 'L' (losers), 'GF' (grand final / reset).
-- next_match_id = where the WINNER goes; loser_to_id = where the LOSER goes
-- (null in L-final and GF). For single_elim, only 'W' rows are emitted
-- and loser_to_id stays null.
create table if not exists fixtures (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  category_code   text not null,
  bracket         text not null default 'W'
                  check (bracket in ('W','L','GF')),
  round_no        int not null,
  match_no        int not null,
  entry_a_id      uuid references entries(id),
  entry_b_id      uuid references entries(id),
  winner_entry_id uuid references entries(id),
  next_match_id   uuid references fixtures(id),
  loser_to_id     uuid references fixtures(id),
  unique (event_id, category_code, bracket, round_no, match_no)
);
create index if not exists fixtures_event_cat_idx
  on fixtures(event_id, category_code, bracket, round_no, match_no);

-- 3.9 RLS -----------------------------------------------------------
alter table payments  enable row level security;
alter table weigh_ins enable row level security;
alter table audit_log enable row level security;
alter table entries   enable row level security;
alter table fixtures  enable row level security;

-- helper
create or replace function role_at_least(min_role text) returns boolean
language sql stable as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and case min_role
        when 'operator'    then p.role in ('operator','weigh_in_official','super_admin','federation_admin','organiser')
        when 'super_admin' then p.role = 'super_admin'
        else false
      end
      and p.disabled_at is null
  );
$$;

create policy "audit_log_insert_any" on audit_log for insert
  with check (auth.uid() is not null);
create policy "audit_log_super_read" on audit_log for select
  using (role_at_least('super_admin'));
-- payments / weigh_ins / entries / fixtures: read+write require operator+
-- (full policies in the migration file).
```

Reference data (33 TN districts, 8 IAFF age bands, WAF/IAFF weight
classes, Para classes) lives in `web/src/lib/rules/` constants.
These are **implementation lookups**, not selectable "rule sets" —
there is no per-event rulebook picker.

## 4. Routes

### 4.1 Public

```
GET  /                              landing
GET  /e/<slug>                      event public page (banner, schedule, register CTA)
GET  /e/<slug>/register             registration form (Para sub-form conditional)
POST /api/register                  create registration + payments(pending)
GET  /e/<slug>/registered/<id>      thank-you (chest-no, UPI QR, upload-proof) — NO photo
POST /api/payment/proof             attach UTR + screenshot
GET  /e/<slug>/fixtures             stretch §6: public bracket view
```

### 4.2 Auth (operators only)

```
GET  /login
POST /api/login                     → cookie session
POST /api/logout
GET  /accept-invite?token=...       finalise invited operator's password
```

### 4.3 Operator

```
GET  /admin                                       dashboard
GET  /admin/registrations?event=<id>              search + filters
GET  /admin/registrations/[id]                    detail / edit / verify / weigh-in
POST /api/registrations/[id]                      update
POST /api/payments/[id]/verify                    + audit
POST /api/payments/[id]/reject                    + audit
GET  /admin/weighin?event=<id>                    queue
GET  /admin/weighin/[id]                          webcam capture + scale weight
POST /api/weighin/[id]                            IndexedDB queue + Supabase
GET  /admin/categories?event=<id>                 overview + Generate Fixtures
POST /api/fixtures/generate                       rebuild entries + fixtures (double-elim default)
POST /api/fixtures/[id]/result                    record winner → advances winner + loser slots
GET  /admin/brackets?event=<id>&cat=<code>        live W/L bracket view
GET  /admin/print?event=<id>                      PDF launcher
POST /api/pdf/{nominal|category|id-cards|fixtures|pending-dues}
GET  /api/export/csv?table=...&event=<id>         CSV dump
POST /api/upload                                  multipart → R2 (compressed)
```

### 4.4 Super admin

**Events**
```
GET  /admin/events                                list (any status)
GET  /admin/events/new                            5-step create wizard
POST /api/events                                  create (status=draft)
GET  /admin/events/[id]                           overview + Publish/Close/Reopen
GET  /admin/events/[id]/edit                      basics, dates, venue, fees, bracket_format
POST /api/events/[id]                             update
GET  /admin/events/[id]/branding                  logo + colours + ID-card content + live preview
POST /api/events/[id]/branding                    persist branding
POST /api/events/[id]/publish                     set registration_published_at
POST /api/events/[id]/close-reg                   set registration_closed_at
POST /api/events/[id]/reopen-reg                  clear registration_closed_at
GET  /admin/events/all-registrations              cross-event view
```

The **create-event wizard** has 5 collapsible sections (Basics,
Format, Payment, Branding, Operators). "Format" is where the operator
picks `bracket_format` (double-elim default) and confirms fee.
Event becomes publicly registerable only when all sections validate
AND super admin taps PUBLISH.

**Users**
```
GET  /admin/users                                 list with role badges + last-active
POST /api/users/invite                            invite by email (Supabase Auth admin invite)
POST /api/users/[id]/role                         change role
POST /api/users/[id]/disable
POST /api/users/[id]/promote-super                shortcut → role='super_admin'
DELETE /api/users/[id]                            only if no audit history; else disable
```

Guard rails: a super admin cannot demote/disable themselves; system
refuses if it would leave zero super admins.

**Other**
```
GET  /admin/audit                                 audit-log viewer
GET  /admin/categories?event=<id>                 overview + Generate Fixtures
POST /api/fixtures/generate                       rebuild entries + fixtures
```

~33 endpoints total.

## 5. Day-by-day plan

### Day 1 — Foundation, Supabase, R2, sample-data seed
- Add `0003_week1.sql`. Apply to Supabase.
- Wire `@supabase/ssr` server + browser client. Middleware gating
  `/admin/*` on session+role; `/admin/events/new`, `/admin/users/*`,
  `/admin/audit` on `super_admin`.
- Cloudflare R2 setup: create account (free), one bucket
  `dino-arm-tourney-media` (private), one bucket
  `dino-arm-tourney-public` (logos/banners/signatures).
  Env vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`,
  `R2_PUBLIC_BASE_URL`.
- `web/src/lib/storage.ts` — thin wrapper over `@aws-sdk/client-s3`:
  `putObject(key, buf, contentType, isPublic)` and
  `signedUrl(key, ttl)`.
- `web/src/lib/image.ts` — `sharp` pipeline: resize, JPEG q=75, strip
  EXIF, reject > 500 KB.
- Rules constants in `web/src/lib/rules/`:
  `tn-districts.ts`, `age-bands.ts`, `weight-classes.ts`, `para.ts`.
- **Sample-data fixtures + seeder** (mock data → real Postgres):
  - `web/seed/sample/{events,users,registrations,payments,weigh_ins}.json`.
  - 2 events (TN State 2026 in `draft` + a finished demo in `archived`).
  - 1 super_admin (you), 2 operators, 1 weigh-in official.
  - ~80 athletes across all divisions/ages with plausible districts,
    weights, statuses (pending/verified/weighed_in).
  - `npm run seed:sample` — Node script using Supabase service-role
    key, idempotent via stable UUIDs (`00000000-0000-0000-0000-…`).
  - `npm run seed:reset` — wipes only sample-flagged rows.

### Day 2 — Public registration + payment proof
- `/e/<slug>/register` form, mobile-first, dark green/yellow.
  Para sub-form reveals when division ∈ {Para Men, Para Women}.
- Photo upload → `POST /api/upload` → compressed → R2 private bucket.
- Create `registrations` row; derive age categories from DOB; create
  `payments(pending)` row.
- Thank-you page (no photo): chest-no, UPI QR for `event.upi_id` +
  amount, inputs for UTR + screenshot upload.
- `POST /api/payment/proof` writes UTR + uploads screenshot to R2.
- `recordAudit(action, target, payload)` helper wired from the start;
  every endpoint logs by default.

### Day 3 — Super-admin event management + operator console
- `/admin/events` list with status pills
  (draft / published-open / closed / archived).
- `/admin/events/new` wizard (Basics, Format, Payment, Branding,
  Operators). Format step exposes `bracket_format` with double-elim
  pre-selected.
- `/admin/events/[id]` overview: counts, registration status, big
  PUBLISH / CLOSE / REOPEN buttons.
- `/admin/events/[id]/branding` form with **live ID-card preview**
  (renders the React-PDF component inline as a thumbnail).
- `/admin/events/[id]/registrations` and
  `/admin/events/all-registrations` with search, filters, CSV export.
- `/admin/users` — list, invite (Supabase Auth admin invite), change
  role, promote-to-super, disable. No-self-demote +
  last-super-admin guard rails.
- Public registration form reads `registration_published_at` and
  `registration_closed_at` to show
  `Coming soon / Open / Closed`.

### Day 4 — Weigh-in + offline queue
- `/admin/weighin` queue grouped by status.
- Detail page: webcam capture (`getUserMedia`) → JPEG canvas → POST.
- `web/src/lib/sync/queue.ts` (~80 LoC IndexedDB write-queue) wraps
  `weighin` and `payment-verify` endpoints. Header status pill:
  "All synced" / "N pending — will retry".
- Retry loop on `online` event + 15 s interval + window focus.

### Day 5 — Resolver + double-elim fixtures + PDFs (event-specific branding)
- `web/src/lib/rules/resolve.ts`: pure
  `(registration, latestWeighIn) -> Entry[]`. Para = single-arm.
  Able-bodied may produce up to four entries (Youth R/L + Senior R/L)
  per athlete. Unit-tested.
- `web/src/lib/rules/bracket.ts`: pure **double-elim** generator
  (default). Input `Entry[]` for one category; output `Fixture[]`
  covering W-bracket, L-bracket, GF + reset match. Standard seed
  table for powers of 2 with byes; loser-drop pattern per round.
  Also exposes a `single_elim` path behind `event.bracket_format`.
  Thorough unit tests: 2/3/4/5/8/9/16-entrant, byes, single/zero
  entrants.
- `POST /api/fixtures/generate`: rebuilds `entries` + `fixtures` for
  every category. Double-elim by default; single-elim when event
  flag is set. Seeded byes + district-spread heuristic in round 1.
- `POST /api/fixtures/[id]/result`: records winner, writes winner to
  `next_match_id` slot + loser to `loser_to_id` slot, audits.
- `/admin/brackets?event=<id>&cat=<code>`: live W/L view, click to
  record result.
- `@react-pdf/renderer` components, **all reading event row** for
  branding/content:
  - `NominalSheet` — alphabetical roster.
  - `CategorySheet` — grouped Division × Age × Weight × Hand.
  - `IdCardSheet` — 8-up A4 mirroring the existing TN AWA card.
    Pulls every value from event (`logo_url`, `primary_color`,
    `accent_color`, `text_on_primary`, `id_card_org_name`,
    `id_card_event_title`, `id_card_subtitle`, `id_card_footer`,
    `id_card_signatory_name`, `id_card_signatory_title`,
    `id_card_signature_url`). No globals, no hard-coded strings.
  - `FixturesSheet` — W + L bracket tree per category, paginated.
  - `PendingDuesSheet`.
- `/admin/print` wires all five.

### Day 6 — Hardening + match-day prep
- `scripts/cache-photos.mjs` — pulls every photo (registration +
  weigh-in + logo) from R2 into `web/public/cached/<id>.jpg`. App
  prefers `/cached/` URLs when present. **This is mandatory, not
  optional.**
- `/admin/audit` viewer with filters by actor / action / event / date.
- CSV export endpoint for every table.
- `docs/match-day.md`:
  - `npm run build && npm start -- -H 0.0.0.0 -p 3000`
  - find LAN IP, share `http://<ip>:3000` via QR for operators
  - `node scripts/cache-photos.mjs` before doors open
  - keep WAN cable in; offline queue is insurance
- Smoke: 50 fake registrations end-to-end, verify payments, weigh-in
  30, generate every PDF, generate double-elim fixtures for ≥3
  categories, walk the W→L→GF result flow on one of them.

### Day 7 — Buffer + dress rehearsal
- Real volunteers if possible. Real printer test for ID cards
  (margins, photo fidelity, QR readability).
- Real UPI verification walkthrough with the org's bank app.
- Fix only blocking bugs. No new features.

## 6. Stretch goals (only if Day 7 has free hours)

1. **Razorpay Standard Checkout** behind `event.payment_provider`
   flag (~3–4 hr).
2. **Public read-only fixtures page** `/e/<slug>/fixtures`.
3. **Tamil labels** on registration form + ID card.
4. **WhatsApp share** link on thank-you page.
5. **Realtime dashboard** — Supabase Realtime push of new
   registrations to operator dashboard.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Supabase free DB 500 MB ceiling | Verified: ~35 MB at 2000 athletes (§1.4). 14× headroom. |
| R2 free 10 GB storage ceiling | Verified: ~525 MB at 2000 athletes (§1.4). Image compression mandatory (§1.5). |
| Supabase free egress 5 GB/mo | All media on R2 (zero egress). Supabase egress is DB queries only. |
| Athlete mistypes UTR | Operator can edit before verifying; full screenshot on file. |
| Two operators verify same payment | DB guard: `verify` writes `verified_by`/`verified_at` only when null; second tap is a no-op. |
| WAN dies on match day | Weigh-in + payment-verify queued in IndexedDB. Public registration is closed by then anyway. |
| Operator quits / hostile | Super-admin revokes role instantly; full audit history; operators cannot delete payments/weigh-ins (only mark rejected). |
| ID-card design changes day-of | All branding + content fields editable from `/admin/events/[id]/branding`; PDF re-renders on next print. |
| Aadhaar PII leak via screenshot | Aadhaar masked at write (last 4 only). Payment screenshots on **R2 private bucket**; only signed URLs minted on operator click; TTL 5 min. |
| Cloudflare R2 outage | Photos served from `web/public/cached/` on the laptop on match day. Pre-event registration falls back to retry — R2 SLA 99.9%. |
| Bracket bug at the table | `bracket.ts` unit tests cover byes, odd counts, reset match. Worst case: regenerate from `/admin/categories`. |
| Supabase project paused after 7 days idle | Cron-job.org pings `/api/healthcheck` daily. Free. |

## 8. Open decisions (none block Day 1)

1. **Operator names + emails** — invite from `/admin/users` any time.
2. **Event basics** — enter via `/admin/events/new`; sample seed has
   placeholders.
3. **Org's UPI id + payee name** — set in event Payment section.
4. **Logo file** + brand colour overrides — set in Branding section.
5. **Per-category fee overrides** — `events.fee_overrides` jsonb if
   needed.
6. **ID-card content** — org name, event title, subtitle, footer,
   signatory + signature image. All editable per event.
7. **Bracket format per event** — default `double_elim`; flip to
   `single_elim` in the Format step of the create wizard if needed.

All defaults are seeded; replace through the super-admin UI any time
before going live.

---

**Ready to build.** Day 1 starts on confirmation.

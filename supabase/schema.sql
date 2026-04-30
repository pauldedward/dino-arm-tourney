-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — consolidated schema bundle
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   npm run schema:bundle    (from web/)
--
-- Source: supabase/migrations/*.sql (46 files)
-- Generated: 2026-04-30T09:14:39.206Z
--
-- Apply to a fresh Supabase project by pasting this whole file into the
-- SQL Editor (Supabase Dashboard → SQL Editor → New query → Run).
-- Idempotent: safe to re-run on a partially-applied DB.
-- ─────────────────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════════════════
-- 0001_init.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — schema v1 (M0)
-- Minimal entities to register events and athletes. Expanded in M1+.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- A federation/sanctioning body or independent organiser.
create table if not exists organizations (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  kind         text not null check (kind in ('federation','organiser','league','club')),
  country      text not null default 'IN',
  region       text,
  created_at   timestamptz not null default now()
);

-- App users link to Supabase auth.users via id.
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  phone        text,
  role         text not null default 'athlete'
                check (role in ('athlete','organiser','federation_admin','referee','medical','accounts','super_admin')),
  created_at   timestamptz not null default now()
);

-- Athlete-specific fields (1:1 with profile when role includes athlete duties).
create table if not exists athletes (
  id           uuid primary key references profiles(id) on delete cascade,
  date_of_birth date,
  gender       text check (gender in ('M','F','O')),
  state        text,
  district     text,
  pan_masked   text,           -- store last 4 only for KYC display
  aadhaar_masked text,
  created_at   timestamptz not null default now()
);

-- Rule profile encodes WAF/IAFF/PPL/etc. as data.
create table if not exists rule_profiles (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,           -- e.g. 'WAF-2022', 'IAFF-2024'
  name         text not null,
  bracket_default text not null default 'double_elim'
    check (bracket_default in ('double_elim','single_elim','round_robin','top8_no_loser','six_round_supermatch')),
  protest_fee_inr int default 500,
  warnings_per_foul int default 2,
  fouls_to_lose int default 2,
  weight_classes jsonb not null default '[]'::jsonb,  -- ordered list of {code,label,upper_kg,lower_kg,division}
  created_at   timestamptz not null default now()
);

-- A tournament instance.
create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_profile_id uuid references rule_profiles(id),
  slug          text not null unique,
  name          text not null,
  status        text not null default 'draft'
                  check (status in ('draft','open','live','completed','archived')),
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  venue_name    text,
  venue_city    text,
  venue_state   text,
  cover_url     text,
  description   text,
  entry_fee_inr int default 0,
  currency      text not null default 'INR',
  prize_pool_inr bigint default 0,
  registration_opens_at  timestamptz,
  registration_closes_at timestamptz,
  weigh_in_starts_at     timestamptz,
  weigh_in_ends_at       timestamptz,
  hand          text not null default 'right' check (hand in ('right','left','both')),
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

create index if not exists events_status_idx on events(status);
create index if not exists events_starts_at_idx on events(starts_at);

-- Registrations (athlete -> event -> weight_class code).
create table if not exists registrations (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  athlete_id   uuid not null references athletes(id) on delete cascade,
  weight_class_code text not null,
  hand         text not null default 'right',
  status       text not null default 'pending'
                check (status in ('pending','paid','weighed_in','withdrawn','disqualified')),
  paid_amount_inr int default 0,
  payment_ref  text,
  created_at   timestamptz not null default now(),
  unique (event_id, athlete_id, weight_class_code, hand)
);

-- ─── Seed: WAF-2022 rule profile (subset) ──────────────────────────────────
insert into rule_profiles (code, name, bracket_default, protest_fee_inr, weight_classes)
values (
  'WAF-2022',
  'WAF World Championship 2022',
  'double_elim',
  500,
  $$[
    {"division":"senior_men","code":"M55","label":"Men 55 kg","upper_kg":55},
    {"division":"senior_men","code":"M60","label":"Men 60 kg","upper_kg":60},
    {"division":"senior_men","code":"M65","label":"Men 65 kg","upper_kg":65},
    {"division":"senior_men","code":"M70","label":"Men 70 kg","upper_kg":70},
    {"division":"senior_men","code":"M75","label":"Men 75 kg","upper_kg":75},
    {"division":"senior_men","code":"M80","label":"Men 80 kg","upper_kg":80},
    {"division":"senior_men","code":"M85","label":"Men 85 kg","upper_kg":85},
    {"division":"senior_men","code":"M90","label":"Men 90 kg","upper_kg":90},
    {"division":"senior_men","code":"M100","label":"Men 100 kg","upper_kg":100},
    {"division":"senior_men","code":"M110","label":"Men 110 kg","upper_kg":110},
    {"division":"senior_men","code":"M110P","label":"Men +110 kg","upper_kg":null},
    {"division":"senior_women","code":"W50","label":"Women 50 kg","upper_kg":50},
    {"division":"senior_women","code":"W55","label":"Women 55 kg","upper_kg":55},
    {"division":"senior_women","code":"W60","label":"Women 60 kg","upper_kg":60},
    {"division":"senior_women","code":"W65","label":"Women 65 kg","upper_kg":65},
    {"division":"senior_women","code":"W70","label":"Women 70 kg","upper_kg":70},
    {"division":"senior_women","code":"W80","label":"Women 80 kg","upper_kg":80},
    {"division":"senior_women","code":"W90","label":"Women 90 kg","upper_kg":90},
    {"division":"senior_women","code":"W90P","label":"Women +90 kg","upper_kg":null}
  ]$$::jsonb
)
on conflict (code) do nothing;

-- IAFF-2024 (Indian-style men's classes used by Pro Panja League).
insert into rule_profiles (code, name, bracket_default, protest_fee_inr, weight_classes)
values (
  'IAFF-2024',
  'Indian Arm-wrestling Federation 2024',
  'double_elim',
  500,
  $$[
    {"division":"senior_men","code":"IM60","label":"Men <60 kg","upper_kg":60},
    {"division":"senior_men","code":"IM70","label":"Men 60-70 kg","upper_kg":70},
    {"division":"senior_men","code":"IM80","label":"Men 70-80 kg","upper_kg":80},
    {"division":"senior_men","code":"IM90","label":"Men 80-90 kg","upper_kg":90},
    {"division":"senior_men","code":"IM100","label":"Men 90-100 kg","upper_kg":100},
    {"division":"senior_men","code":"IM100P","label":"Men >100 kg","upper_kg":null},
    {"division":"senior_women","code":"IW55","label":"Women <55 kg","upper_kg":55},
    {"division":"senior_women","code":"IW65","label":"Women 55-65 kg","upper_kg":65},
    {"division":"senior_women","code":"IW65P","label":"Women >65 kg","upper_kg":null}
  ]$$::jsonb
)
on conflict (code) do nothing;

-- ─── Row-level security ──────────────────────────────────────────────────
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table athletes enable row level security;
alter table events enable row level security;
alter table registrations enable row level security;

-- Public read: orgs, events that are not 'draft', rule profiles.
create policy "orgs_public_read" on organizations for select using (true);
create policy "events_public_read" on events for select using (status <> 'draft');

create policy "profiles_self" on profiles for select using (auth.uid() = id);
create policy "profiles_self_update" on profiles for update using (auth.uid() = id);

create policy "athletes_self" on athletes for select using (auth.uid() = id);
create policy "athletes_self_update" on athletes for update using (auth.uid() = id);

create policy "registrations_self" on registrations
  for select using (auth.uid() = athlete_id);
create policy "registrations_self_insert" on registrations
  for insert with check (auth.uid() = athlete_id);

-- Organisers: TODO in M1 (org-membership table + policies for events draft + registrations admin).

-- ════════════════════════════════════════════════════════════════════════════
-- 0002_hubs_eventlog.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — schema v2: edge-plane (hubs, tables, categories, event_log)
-- Implements §11 Multi-Hub model and §12 Tamper-proof event log from PLAN.md.
-- ─────────────────────────────────────────────────────────────────────────────

-- A "category" is one weight-class within an event that runs as a unit
-- (e.g. Senior Men 80 kg right-hand). Distinct from the rule-profile's
-- weight_classes JSON because one event may run a subset on a given day.
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  weight_class_code text not null,            -- references rule_profile JSON
  hand          text not null default 'right' check (hand in ('right','left')),
  division      text not null,                -- 'senior_men','para_open',...
  display_name  text not null,
  status        text not null default 'pending'
                 check (status in ('pending','calling','live','paused','completed')),
  bracket_format text not null default 'double_elim',
  created_at    timestamptz not null default now(),
  unique (event_id, weight_class_code, hand)
);
create index if not exists categories_event_idx on categories(event_id);

-- Physical tables in the venue (Table 1, Table 2, ...).
create table if not exists venue_tables (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  number       int  not null,
  label        text,
  unique (event_id, number)
);

-- A Category Hub: software node that owns one or more categories on one table.
-- Maps 1:1 to a laptop in practice but is logical, not physical.
create table if not exists hubs (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  table_id     uuid references venue_tables(id) on delete set null,
  code         text not null,                 -- 'hub-m80', 'hub-w-open'
  display_name text not null,
  status       text not null default 'offline'
                check (status in ('offline','online','degraded','retired')),
  public_key   bytea,                         -- ed25519 hub identity
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (event_id, code)
);

-- Which hub currently owns which category (history-preserving).
-- Only one row per category may have ended_at IS NULL at any time.
create table if not exists category_assignments (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references categories(id) on delete cascade,
  hub_id       uuid not null references hubs(id) on delete cascade,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  reason       text                            -- 'initial','rebalance','hub_failure'
);
create unique index if not exists category_assignments_active_idx
  on category_assignments(category_id) where ended_at is null;

-- Physical devices attached to a hub (laptop itself, MC tablet, side-ref tablet).
create table if not exists hub_devices (
  id           uuid primary key default gen_random_uuid(),
  hub_id       uuid not null references hubs(id) on delete cascade,
  kind         text not null check (kind in
                 ('controller','mc_tablet','sideref_tablet','checkin_tablet','camera','led_display')),
  label        text,
  public_key   bytea,                          -- ed25519 device identity
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- THE event_log: single source of truth, append-only, hash-chained, signed.
-- All other mutable tables are projections of this log.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists event_log (
  id           uuid primary key,                -- client-generated ULID-as-uuid
  event_id     uuid references events(id) on delete cascade,
  category_id  uuid references categories(id) on delete cascade,
  hub_id       uuid references hubs(id) on delete set null,
  device_id    uuid references hub_devices(id) on delete set null,
  actor_id     uuid references profiles(id) on delete set null,
  topic        text not null,                   -- 'match.result' | 'weigh_in.recorded' | ...
  payload      jsonb not null,
  client_ts    timestamptz not null,            -- HLC, monotonic per device
  server_ts    timestamptz not null default now(),
  prev_hash    bytea,                           -- chain to previous row (per hub)
  hash         bytea not null,                  -- sha256(prev_hash || canonical(payload) || client_ts)
  signature    bytea                            -- ed25519, hub key + actor key (concatenated)
);
create index if not exists event_log_topic_idx        on event_log(topic);
create index if not exists event_log_event_idx        on event_log(event_id, server_ts);
create index if not exists event_log_category_idx     on event_log(category_id, server_ts);
create index if not exists event_log_hub_idx          on event_log(hub_id, client_ts);

-- Append-only enforcement: revoke UPDATE & DELETE for everyone.
-- (Service role / superuser still has them for emergency forensic admin.)
revoke update, delete on event_log from public;
revoke update, delete on event_log from anon;
revoke update, delete on event_log from authenticated;

-- Database-side guarantee: forbid update/delete via triggers as well.
create or replace function event_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'event_log is append-only (op=%)', tg_op;
end$$;

drop trigger if exists event_log_no_update on event_log;
drop trigger if exists event_log_no_delete on event_log;
create trigger event_log_no_update before update on event_log
  for each row execute function event_log_immutable();
create trigger event_log_no_delete before delete on event_log
  for each row execute function event_log_immutable();

-- RLS
alter table categories            enable row level security;
alter table venue_tables          enable row level security;
alter table hubs                  enable row level security;
alter table category_assignments  enable row level security;
alter table hub_devices           enable row level security;
alter table event_log             enable row level security;

-- Public read for spectator views (only published events).
create policy "categories_public_read" on categories for select using (
  exists (select 1 from events e where e.id = categories.event_id and e.status <> 'draft')
);
create policy "venue_tables_public_read" on venue_tables for select using (
  exists (select 1 from events e where e.id = venue_tables.event_id and e.status <> 'draft')
);
create policy "hubs_public_read" on hubs for select using (
  exists (select 1 from events e where e.id = hubs.event_id and e.status <> 'draft')
);
create policy "category_assignments_public_read" on category_assignments for select using (true);

-- Event log: public can read only payloads of topics flagged spectator-safe.
-- For M0 we keep it server-side only (no client policy).
-- Insert-only via service role (the venue sync server / cloud bridge).

-- ════════════════════════════════════════════════════════════════════════════
-- 0003_week1.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — schema v3 (Week 1 production cut)
-- Adds operator roles, event publish/close + branding + ID-card content,
-- Para athlete fields, denormalised registrations, payments, weigh-ins,
-- entries, fixtures, and a per-actor audit log.
--
-- Strictly additive. No destructive changes to 0001_init or 0002_hubs_eventlog.
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 Roles ------------------------------------------------------------------
alter table profiles
  drop constraint if exists profiles_role_check;
alter table profiles
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

create index if not exists profiles_role_idx on profiles(role) where disabled_at is null;

-- 3.2 Events: publish/close, branding, full ID-card content ------------------
alter table events
  add column if not exists registration_published_at timestamptz,
  add column if not exists registration_closed_at  timestamptz,
  add column if not exists payment_provider        text not null default 'manual_upi'
    check (payment_provider in ('manual_upi','razorpay','none')),
  add column if not exists upi_id                  text,
  add column if not exists upi_payee_name          text,
  add column if not exists entry_fee_default_inr   int default 500,
  add column if not exists fee_overrides           jsonb default '{}'::jsonb,
  -- Branding
  add column if not exists logo_url                text,
  add column if not exists banner_url              text,
  add column if not exists primary_color           text default '#0f3d2e',
  add column if not exists accent_color            text default '#f5c518',
  add column if not exists text_on_primary         text default '#ffffff',
  add column if not exists id_card_template        text default 'tnawa_v1',
  -- ID-card content
  add column if not exists id_card_org_name        text,
  add column if not exists id_card_event_title     text,
  add column if not exists id_card_subtitle        text,
  add column if not exists id_card_footer          text,
  add column if not exists id_card_signatory_name  text,
  add column if not exists id_card_signatory_title text,
  add column if not exists id_card_signature_url   text;

-- 3.3 Para fields on athletes ------------------------------------------------
alter table athletes
  add column if not exists is_para       boolean not null default false,
  add column if not exists para_class    text
    check (para_class in ('PD1','PD2','PS1','PS2','PS3','B1','B2','B3')),
  add column if not exists para_posture  text
    check (para_posture in ('Standing','Seated'));

-- 3.4 Registrations: denormalised snapshot of form submission ----------------
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
  add column if not exists photo_url          text,
  add column if not exists photo_bytes        int,
  add column if not exists submitted_by       text default 'self';

-- chest_no is unique per event.
create unique index if not exists registrations_event_chest_no_idx
  on registrations(event_id, chest_no) where chest_no is not null;

-- 3.5 Payments ---------------------------------------------------------------
create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  amount_inr      int not null,
  method          text not null check (method in ('manual_upi','razorpay','cash','waiver')),
  utr             text,
  proof_url       text,
  status          text not null default 'pending'
                  check (status in ('pending','verified','rejected')),
  verified_by     uuid references profiles(id),
  verified_at     timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists payments_registration_idx on payments(registration_id);
create index if not exists payments_status_idx       on payments(status);

-- 3.6 Weigh-ins (append-only for a given registration) -----------------------
create table if not exists weigh_ins (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  measured_kg     numeric(5,2) not null,
  live_photo_url  text,
  scale_photo_url text,
  weighed_by      uuid references profiles(id),
  weighed_at      timestamptz not null default now()
);
create index if not exists weigh_ins_registration_idx on weigh_ins(registration_id, weighed_at desc);

-- 3.7 Audit log --------------------------------------------------------------
create table if not exists audit_log (
  id              bigserial primary key,
  event_id        uuid references events(id) on delete set null,
  actor_id        uuid references profiles(id) on delete set null,
  actor_label     text,
  action          text not null,
  target_table    text,
  target_id       text,
  payload         jsonb,
  client_ip       text,
  created_at      timestamptz not null default now()
);
create index if not exists audit_log_event_idx on audit_log(event_id, created_at desc);
create index if not exists audit_log_actor_idx on audit_log(actor_id, created_at desc);
create index if not exists audit_log_action_idx on audit_log(action, created_at desc);

-- 3.8 Entries + Fixtures (single-elim this week, double-elim Week 2) --------
create table if not exists entries (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  division        text not null,
  age_band        text not null,
  weight_class    text not null,
  hand            text not null check (hand in ('R','L')),
  category_code   text not null,
  seed            int,
  created_at      timestamptz not null default now(),
  unique (registration_id, division, age_band, weight_class, hand)
);
create index if not exists entries_category_idx on entries(category_code);

create table if not exists fixtures (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  category_code   text not null,
  round_no        int not null,
  match_no        int not null,
  entry_a_id      uuid references entries(id) on delete set null,
  entry_b_id      uuid references entries(id) on delete set null,
  next_match_id   uuid references fixtures(id) on delete set null,
  winner_entry_id uuid references entries(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (event_id, category_code, round_no, match_no)
);
create index if not exists fixtures_event_cat_idx on fixtures(event_id, category_code);

-- 3.9 RLS --------------------------------------------------------------------
alter table payments  enable row level security;
alter table weigh_ins enable row level security;
alter table audit_log enable row level security;
alter table entries   enable row level security;
alter table fixtures  enable row level security;

-- Helper: is the current session at least <min_role>?
create or replace function role_at_least(min_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.disabled_at is null
      and case min_role
        when 'operator'    then p.role in ('operator','weigh_in_official','super_admin','federation_admin','organiser')
        when 'super_admin' then p.role = 'super_admin'
        else false
      end
  );
$$;

-- Public read policies already exist on categories/venue_tables/hubs
-- from 0002; the week-1 tables below are operator-only.

-- Payments: operators read, operators/super write.
drop policy if exists "payments_operator_read"   on payments;
drop policy if exists "payments_operator_write"  on payments;
create policy "payments_operator_read"  on payments for select
  using (role_at_least('operator'));
create policy "payments_operator_write" on payments for all
  using (role_at_least('operator')) with check (role_at_least('operator'));

-- Weigh-ins: operators read, operators write (append-only enforced by code).
drop policy if exists "weigh_ins_operator_read"  on weigh_ins;
drop policy if exists "weigh_ins_operator_write" on weigh_ins;
create policy "weigh_ins_operator_read"  on weigh_ins for select
  using (role_at_least('operator'));
create policy "weigh_ins_operator_write" on weigh_ins for insert
  with check (role_at_least('operator'));

-- Audit log: anyone logged in can insert a row scoped to themselves;
-- only super admins can read.
drop policy if exists "audit_log_insert_any" on audit_log;
drop policy if exists "audit_log_super_read" on audit_log;
create policy "audit_log_insert_any" on audit_log for insert
  with check (auth.uid() is not null);
create policy "audit_log_super_read" on audit_log for select
  using (role_at_least('super_admin'));

-- Entries + fixtures: public read (spectators), operator write.
drop policy if exists "entries_public_read"  on entries;
drop policy if exists "entries_operator_write" on entries;
create policy "entries_public_read" on entries for select using (true);
create policy "entries_operator_write" on entries for all
  using (role_at_least('operator')) with check (role_at_least('operator'));

drop policy if exists "fixtures_public_read"  on fixtures;
drop policy if exists "fixtures_operator_write" on fixtures;
create policy "fixtures_public_read" on fixtures for select using (true);
create policy "fixtures_operator_write" on fixtures for all
  using (role_at_least('operator')) with check (role_at_least('operator'));

-- Also allow operators to read all registrations in their events.
drop policy if exists "registrations_operator_read" on registrations;
create policy "registrations_operator_read" on registrations for select
  using (role_at_least('operator'));
drop policy if exists "registrations_operator_write" on registrations;
create policy "registrations_operator_write" on registrations for update
  using (role_at_least('operator')) with check (role_at_least('operator'));

-- Public registration INSERT: allow anon (submitted_by = 'self') to create
-- a row bound to an event whose registration is open. The API route
-- enforces this business rule; we mirror the minimum here.
drop policy if exists "registrations_public_insert" on registrations;
create policy "registrations_public_insert" on registrations for insert
  with check (
    exists (
      select 1 from events e
      where e.id = registrations.event_id
        and e.registration_published_at is not null
        and (e.registration_closed_at is null or e.registration_closed_at > now())
    )
  );

-- Payments INSERT by anon when attaching UPI proof for their own registration.
drop policy if exists "payments_public_insert" on payments;
create policy "payments_public_insert" on payments for insert
  with check (true); -- API route binds registration_id and validates.

-- Events: allow super_admin to write (publish/close/update).
drop policy if exists "events_super_write" on events;
create policy "events_super_write" on events for all
  using (role_at_least('super_admin')) with check (role_at_least('super_admin'));

-- Profiles: super admins can manage all profiles (invite/disable/role change).
drop policy if exists "profiles_super_all" on profiles;
create policy "profiles_super_all" on profiles for all
  using (role_at_least('super_admin')) with check (role_at_least('super_admin'));

-- Athletes: super admins can see all.
drop policy if exists "athletes_super_all" on athletes;
create policy "athletes_super_all" on athletes for all
  using (role_at_least('super_admin')) with check (role_at_least('super_admin'));

-- ════════════════════════════════════════════════════════════════════════════
-- 0004_event_poster.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — 0004: event poster (image or PDF)
--
-- Per-event flyer shown on the public event page and above the registration
-- form. Stored on R2 public bucket, URL on events.poster_url. Kind lets the
-- UI pick between <img> and a PDF embed/link.
-- ─────────────────────────────────────────────────────────────────────────────

alter table events
  add column if not exists poster_url  text,
  add column if not exists poster_kind text
    check (poster_kind in ('image','pdf'));

-- ════════════════════════════════════════════════════════════════════════════
-- 0005_audit_log_event_set_null.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Ensure deleting an event does not fail because of audit_log FK.
-- Replace the existing FK (which may have been created without ON DELETE SET NULL
-- on some environments) with one that sets event_id to NULL on event deletion.

alter table audit_log
  drop constraint if exists audit_log_event_id_fkey;

alter table audit_log
  add constraint audit_log_event_id_fkey
  foreign key (event_id) references events(id) on delete set null;

-- ════════════════════════════════════════════════════════════════════════════
-- 0006_athlete_registration_auth.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_athlete_registration_auth
--
-- Require every registration to be tied to an authenticated athlete account
-- (auth.users → profiles → athletes). Enforces "one registration per athlete
-- per event" with a unique index and tightens RLS so anon cannot insert.
--
-- Legacy pilot rows with a NULL athlete_id are dropped (cascades to entries;
-- fixtures get their entry refs nulled to keep bracket history intact).
-- ─────────────────────────────────────────────────────────────────────────────

-- Repair fixtures FKs — 0003's intent was ON DELETE SET NULL but some
-- environments have plain FKs. Make the behaviour match before we cascade.
alter table fixtures
  drop constraint if exists fixtures_entry_a_id_fkey,
  drop constraint if exists fixtures_entry_b_id_fkey,
  drop constraint if exists fixtures_next_match_id_fkey;
alter table fixtures
  add constraint fixtures_entry_a_id_fkey
    foreign key (entry_a_id) references entries(id) on delete set null,
  add constraint fixtures_entry_b_id_fkey
    foreign key (entry_b_id) references entries(id) on delete set null,
  add constraint fixtures_next_match_id_fkey
    foreign key (next_match_id) references fixtures(id) on delete set null;

-- Drop legacy orphan registrations (cascades through entries).
delete from registrations where athlete_id is null;

alter table registrations
  alter column athlete_id set not null;

-- One registration per athlete per event.
drop index if exists registrations_event_athlete_uidx;
create unique index registrations_event_athlete_uidx
  on registrations(event_id, athlete_id);

-- Replace the anon-insert policy with a self-insert policy.
drop policy if exists "registrations_public_insert" on registrations;
drop policy if exists "registrations_self_insert" on registrations;
create policy "registrations_self_insert" on registrations for insert
  with check (
    auth.uid() = athlete_id
    and exists (
      select 1 from events e
      where e.id = registrations.event_id
        and e.registration_published_at is not null
        and (e.registration_closed_at is null or e.registration_closed_at > now())
    )
  );

-- Payments: keep insert open (API binds registration_id), but add self-read
-- so athletes can see their own payment status on the confirmation page.
drop policy if exists "payments_self_read" on payments;
create policy "payments_self_read" on payments for select
  using (
    exists (
      select 1 from registrations r
      where r.id = payments.registration_id
        and r.athlete_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 0007_role_simplification.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_role_simplification
-- Collapse roles to three: athlete, operator, super_admin.
-- Federation_admin / organiser / weigh_in_official / referee / medical /
-- accounts all fold into 'operator'. super_admin and athlete untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Remap existing rows BEFORE tightening the check constraint.
update profiles
set role = 'operator'
where role in ('federation_admin','organiser','weigh_in_official',
               'referee','medical','accounts');

-- 2. Replace check constraint.
alter table profiles
  drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
    check (role in ('athlete','operator','super_admin'));

-- 3. Simplify role_at_least helper.
create or replace function role_at_least(min_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.disabled_at is null
      and case min_role
        when 'operator'    then p.role in ('operator','super_admin')
        when 'super_admin' then p.role = 'super_admin'
        else false
      end
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0008_registration_v2.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0008 — Registration model v2
-- Decouple gender from participation track. An athlete now records a
-- gender (M/F) plus optional non-para participation (age classes + hand)
-- AND optional para participation (para classes + hand). Either side
-- alone — or both together — is a valid registration as long as at least
-- one (classes, hand) pair is filled.

alter table registrations
  add column if not exists gender          text check (gender in ('M','F')),
  add column if not exists nonpara_classes text[],
  add column if not exists nonpara_hand    text check (nonpara_hand in ('R','L','B')),
  add column if not exists para_codes      text[],
  add column if not exists para_hand       text check (para_hand in ('R','L','B'));

-- Backfill `gender` from the legacy `division` text where possible. The
-- registration row used to encode gender + para into one string.
update registrations
   set gender = case
                  when division ilike '%women%' then 'F'
                  when division in ('Men','Para Men') then 'M'
                  else gender
                end
 where gender is null;

-- Allow legacy non-WAF para_class values to coexist with the new WAF
-- official codes by dropping the restrictive check. The new para_codes
-- array is the source of truth going forward; `athletes.para_class`
-- becomes a free-form display column.
alter table athletes
  drop constraint if exists athletes_para_class_check;

-- The legacy `division` column on registrations stays for back-compat
-- (admin filters, CSV export, etc.) but is now optional. Existing
-- consumers continue to read it; new registrations write a derived value
-- (Men / Women / Para Men / Para Women) computed from gender + para
-- selection.
alter table registrations
  alter column division drop not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 0009_per_class_hand.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0009 — Per-class non-para hand selection.
-- An athlete can now compete in different hands across age categories
-- (e.g. Junior 18 left, Senior right). `nonpara_hands` is a text[] aligned
-- index-for-index with `nonpara_classes`. The legacy single
-- `nonpara_hand` column stays for back-compat (mirrors index 0).

alter table registrations
  add column if not exists nonpara_hands text[];

-- Backfill: existing rows get the same hand for every class they picked.
-- (`array_fill` repeats the scalar nonpara_hand value into an N-length
-- text[] aligned with nonpara_classes. Earlier draft used a correlated
-- `array_agg` over generate_series, which modern Postgres rejects with
-- "aggregate functions are not allowed in UPDATE".)
update registrations
   set nonpara_hands = array_fill(nonpara_hand, ARRAY[array_length(nonpara_classes, 1)])
 where nonpara_hand is not null
   and nonpara_classes is not null
   and array_length(nonpara_classes, 1) > 0
   and nonpara_hands is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 0010_drop_registrations_para_class_check.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0010 — Drop legacy check constraint on registrations.para_class
--
-- Migration 0008 introduced WAF para codes (e.g. 'U', 'S1', 'S2', etc.) on
-- registrations.para_codes (text[]) as the source of truth. The legacy
-- single `para_class` column on registrations still has a check constraint
-- restricting it to the old TNAWA codes ('PD1','PD2','PS1','PS2','PS3',
-- 'B1','B2','B3'), which now conflicts with new submissions that mirror
-- para_codes[0] into para_class for back-compat.
--
-- 0008 dropped the equivalent constraint on `athletes.para_class` but
-- missed the one on `registrations`. This migration finishes the job.

alter table registrations
  drop constraint if exists registrations_para_class_check;

-- ════════════════════════════════════════════════════════════════════════════
-- 0011_registration_public_token.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0011 — Public, unguessable token for registration confirmation URLs.
--
-- The thank-you / payment-proof page lives at
-- /e/<event-slug>/registered/<token>. It exposes payment status, UPI
-- deep-link, chest number, full name — sensitive enough that the URL
-- itself must act as a bearer secret. The previous URL used the raw
-- registrations.id (UUID v4); UUIDs are non-enumerable but are also a
-- DB primary key we'd rather not splash through email/QR/share links.
--
-- This migration adds a dedicated `public_token` column: 16 hex chars
-- (64 bits of entropy), unique, auto-filled on insert, and backfilled
-- for existing rows.

create extension if not exists pgcrypto;

alter table registrations
  add column if not exists public_token text;

-- Backfill any existing rows with a fresh token.
update registrations
   set public_token = encode(gen_random_bytes(8), 'hex')
 where public_token is null;

-- From now on every insert without an explicit token gets one.
alter table registrations
  alter column public_token set default encode(gen_random_bytes(8), 'hex'),
  alter column public_token set not null;

create unique index if not exists registrations_public_token_idx
  on registrations(public_token);

-- ════════════════════════════════════════════════════════════════════════════
-- 0012_payment_proofs.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0012_payment_proofs.sql
--
-- Allow athletes to submit multiple UTR + screenshot proofs per payment
-- (e.g. the first transfer was rejected, second succeeded). Owner can
-- delete a proof until the payment is verified.
--
-- Backwards compat: payments.utr / payments.proof_url stay in place and
-- are mirrored to the *latest* proof so existing admin UI keeps working.

create table if not exists payment_proofs (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references payments(id) on delete cascade,
  utr         text not null,
  proof_url   text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists payment_proofs_payment_idx
  on payment_proofs(payment_id, created_at desc);

-- Backfill existing single-proof rows so the new UI shows them.
insert into payment_proofs (payment_id, utr, proof_url, created_at)
select id, utr, proof_url, coalesce(created_at, now())
from payments
where utr is not null
  and proof_url is not null
  and not exists (
    select 1 from payment_proofs pp where pp.payment_id = payments.id
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 0013_realtime.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0013 — Enable Supabase Realtime on the tables the UI needs to live-update.
-- Keep this list minimal so the websocket payload stays small. If you add
-- a new table that should drive auto-refresh, add it here.
--
-- Why ALTER PUBLICATION: Supabase ships a single logical publication
-- `supabase_realtime` that the realtime server tails. A table only emits
-- change events when it's a member of that publication.

alter publication supabase_realtime add table public.registrations;
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.payment_proofs;
alter publication supabase_realtime add table public.weigh_ins;
alter publication supabase_realtime add table public.events;

-- Fixtures only exist after Week-1 fixture migration. Guard so this file
-- is safe to run on a DB that hasn't created them yet.
do $$
begin
  if exists (select 1 from pg_class where relname = 'fixtures' and relkind = 'r') then
    execute 'alter publication supabase_realtime add table public.fixtures';
  end if;
  if exists (select 1 from pg_class where relname = 'entries' and relkind = 'r') then
    execute 'alter publication supabase_realtime add table public.entries';
  end if;
end$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0014_event_circular.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — 0014: event circular (PDF flyer for download)
--
-- Some federations distribute a printable "circular" — a multi-page PDF with
-- the entire fee schedule, concessions, age categories, contact numbers, etc.
-- It's downloaded by athletes, separate from the marketing poster.
--
-- Stored in the public R2 bucket; we only keep the URL on the event row.
-- ─────────────────────────────────────────────────────────────────────────────

alter table events
  add column if not exists circular_url text;

-- ════════════════════════════════════════════════════════════════════════════
-- 0015_aadhaar_full.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0015_aadhaar_full.sql
-- Store the full Aadhaar number alongside the masked form so operator
-- workflows (bulk-register edit, audit, payment verification) can
-- round-trip the value the operator typed. The masked column stays for
-- display in lists / exports.
--
-- PII: Full Aadhaar is sensitive. Existing RLS on athletes/registrations
-- already restricts read to operator+ via the service role; do NOT add
-- an `aadhaar` column to any view that the public/athlete role can read.

alter table athletes
  add column if not exists aadhaar text;

alter table registrations
  add column if not exists aadhaar text;

-- Same shape constraint as the masking helper expects (12 digits).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'athletes_aadhaar_format'
  ) then
    alter table athletes
      add constraint athletes_aadhaar_format
      check (aadhaar is null or aadhaar ~ '^[0-9]{12}$');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'registrations_aadhaar_format'
  ) then
    alter table registrations
      add constraint registrations_aadhaar_format
      check (aadhaar is null or aadhaar ~ '^[0-9]{12}$');
  end if;
end$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0016_registrations_perf_indexes.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0016_registrations_perf_indexes.sql
-- Speed up the bulk-register "recent saves" sidebar and the operator
-- registrations listing under common filters.
--
-- Why these specific shapes:
--  * recent-bulk endpoint: WHERE event_id = ? AND submitted_by = 'bulk'
--    ORDER BY created_at DESC LIMIT 50.  Without this the query plans
--    a sort on the whole event partition.
--  * payments-by-registration join: payments(registration_id) is the
--    inner side of the join used everywhere; ensure the index is there.
--  * registrations(status) is filtered on the operator console for the
--    weigh-in queue.

create index if not exists registrations_event_submitted_created_idx
  on registrations (event_id, submitted_by, created_at desc);

create index if not exists registrations_event_status_idx
  on registrations (event_id, status);

create index if not exists payments_registration_id_idx
  on payments (registration_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 0017_event_summary_perf.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0017_event_summary_perf.sql
-- Collapse the /admin/events/[id] dashboard's 3 parallel COUNT(*) queries
-- (~110ms each) into a single round-trip via a SECURITY DEFINER function.
-- Counts go through registrations because payments has no event_id column.

create or replace function public.event_dashboard_counts(p_event_id uuid)
returns table (
  total_regs bigint,
  pending_pays bigint,
  verified_pays bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select id from registrations where event_id = p_event_id
  )
  select
    (select count(*) from r),
    (select count(*) from payments p where p.registration_id in (select id from r) and p.status = 'pending'),
    (select count(*) from payments p where p.registration_id in (select id from r) and p.status = 'verified');
$$;

revoke all on function public.event_dashboard_counts(uuid) from public;
grant execute on function public.event_dashboard_counts(uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 0018_payment_mode.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0018_payment_mode.sql
--
-- Add an explicit `payment_mode` to events so the public registration flow
-- and operator console can branch cleanly between:
--   * online_upi : athletes pay UPI + upload proof (today's default)
--   * offline    : athletes register; operator collects cash/UPI at counter
--                  (or via district incharge in bulk) and ticks them off
--   * hybrid     : both — UPI QR shown but optional, operator can also
--                  collect at the counter
--
-- Inferring the mode from "fee==0 && upi==null" was lossy: turning UPI off
-- also wiped the fee, and the operator console had no payment row to act on
-- for offline athletes (see web/src/app/api/register/route.ts).

alter table events
  add column if not exists payment_mode text not null default 'online_upi'
    check (payment_mode in ('online_upi', 'offline', 'hybrid'));

-- Backfill: existing events with a UPI id keep online_upi; events that were
-- previously the lossy "fee=0, no upi" config become offline so the operator
-- console immediately has rows to collect against.
update events
   set payment_mode =
       case
         when upi_id is not null and coalesce(entry_fee_default_inr, 0) > 0
           then 'online_upi'
         when coalesce(entry_fee_default_inr, 0) > 0
           then 'offline'
         else 'online_upi'
       end
 where payment_mode = 'online_upi';

-- Helper view: per-event payment totals by status. Used by the dashboard
-- "₹ collected / ₹ pending" stats and the by-district summary card.
create or replace view event_payment_totals as
  select r.event_id,
         coalesce(sum(p.amount_inr) filter (where p.status = 'verified'), 0)::int  as collected_inr,
         coalesce(sum(p.amount_inr) filter (where p.status = 'pending'), 0)::int   as pending_inr,
         coalesce(sum(p.amount_inr) filter (where p.status = 'rejected'), 0)::int  as rejected_inr,
         count(*) filter (where p.status = 'verified')::int                        as collected_n,
         count(*) filter (where p.status = 'pending')::int                         as pending_n
    from payments p
    join registrations r on r.id = p.registration_id
   group by r.event_id;

-- Helper view: per-event, per-district totals. Powers the "By district"
-- summary card on the event dashboard.
create or replace view event_district_payment_totals as
  select r.event_id,
         coalesce(r.district, '—') as district,
         count(*)::int                                                              as athletes_n,
         coalesce(sum(p.amount_inr) filter (where p.status = 'verified'), 0)::int   as collected_inr,
         coalesce(sum(p.amount_inr) filter (where p.status = 'pending'), 0)::int    as pending_inr,
         count(*) filter (where p.status = 'verified')::int                         as collected_n,
         count(*) filter (where p.status = 'pending')::int                          as pending_n
    from registrations r
    left join lateral (
      select amount_inr, status
        from payments
       where registration_id = r.id
       order by created_at desc
       limit 1
    ) p on true
   group by r.event_id, coalesce(r.district, '—');

-- Index supports the by-district group-by + bulk-collect lookups.
create index if not exists registrations_event_district_idx
  on registrations (event_id, district);

-- ════════════════════════════════════════════════════════════════════════════
-- 0019_event_dashboard_rpc.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0019_event_dashboard_rpc.sql
-- Single-RTT dashboard fetch for /admin/events/[id]. Returns event row +
-- counts + ₹ totals + per-district totals as one JSON payload. Replaces
-- 4 separate queries (event SELECT + counts RPC + totals view + districts
-- view), saving ~3 RTTs per dashboard load.
create or replace function public.event_dashboard(p_id_or_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_counts jsonb;
  v_totals jsonb;
  v_districts jsonb;
begin
  if p_id_or_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_event from events where id = p_id_or_slug::uuid;
  else
    select * into v_event from events where slug = p_id_or_slug;
  end if;
  if not found then return null; end if;

  with r as (select id, district from registrations where event_id = v_event.id)
  select jsonb_build_object(
    'total_regs',    (select count(*) from r),
    'pending_pays',  (select count(*) from payments p where p.registration_id in (select id from r) and p.status = 'pending'),
    'verified_pays', (select count(*) from payments p where p.registration_id in (select id from r) and p.status = 'verified')
  ) into v_counts;

  select jsonb_build_object(
    'collected_inr', coalesce(sum(amount_inr) filter (where status = 'verified'), 0),
    'pending_inr',   coalesce(sum(amount_inr) filter (where status = 'pending'), 0),
    'collected_n',   count(*) filter (where status = 'verified'),
    'pending_n',     count(*) filter (where status = 'pending')
  ) into v_totals
  from payments p
  where p.registration_id in (select id from registrations where event_id = v_event.id);

  select coalesce(jsonb_agg(d order by d->>'athletes_n' desc), '[]'::jsonb) into v_districts
  from (
    select jsonb_build_object(
      'district',      coalesce(r.district, '—'),
      'athletes_n',    count(*),
      'collected_inr', coalesce(sum(p.amount_inr) filter (where p.status = 'verified'), 0),
      'pending_inr',   coalesce(sum(p.amount_inr) filter (where p.status = 'pending'), 0),
      'collected_n',   count(*) filter (where p.status = 'verified'),
      'pending_n',     count(*) filter (where p.status = 'pending')
    ) as d
    from registrations r
    left join lateral (
      select amount_inr, status from payments
       where registration_id = r.id order by created_at desc limit 1
    ) p on true
    where r.event_id = v_event.id
    group by coalesce(r.district, '—')
  ) s;

  return jsonb_build_object(
    'event',     to_jsonb(v_event),
    'counts',    v_counts,
    'totals',    v_totals,
    'districts', v_districts
  );
end;
$$;

revoke all on function public.event_dashboard(text) from public;
grant execute on function public.event_dashboard(text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 0020_backfill_offline_payment_method.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0020_backfill_offline_payment_method.sql
--
-- Cosmetic backfill: payments inserted before migration 0018 (payment_mode)
-- defaulted to method = 'manual_upi' regardless of how the money actually
-- changed hands. After 0018, the register API and the collect endpoints
-- write 'cash' for offline events, so any pre-0018 row on an event whose
-- payment_mode is now 'offline' is mislabelled and shows up in the
-- operator console with a "UPI" badge instead of "Cash".
--
-- Scope:
--   - only touch payments whose event is now in offline mode,
--   - only flip 'manual_upi' rows (leave 'waiver' alone),
--   - keep status / amount / verified_by / verified_at unchanged.
--
-- Idempotent: running it again is a no-op once the rows are 'cash'.

update payments p
   set method = 'cash'
  from registrations r
  join events e on e.id = r.event_id
 where p.registration_id = r.id
   and e.payment_mode = 'offline'
   and p.method = 'manual_upi';

-- ════════════════════════════════════════════════════════════════════════════
-- 0021_rebrand_iaff_to_pafi.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Rebrand affiliation copy on existing event rows from IAFF
-- (Indian Armwrestling Federation) to PAFI (People's Arm Wrestling
-- Federation India). TNAWA is now affiliated to PAFI.

update events
set id_card_footer = replace(id_card_footer, 'IAFF', 'PAFI')
where id_card_footer like '%IAFF%';

update events
set description = replace(description, 'IAFF', 'PAFI')
where description like '%IAFF%';

update events
set id_card_subtitle = replace(id_card_subtitle, 'IAFF', 'PAFI')
where id_card_subtitle like '%IAFF%';

-- Rename the Indian rule profile from IAFF-2024 to PAFI-2024 (and update
-- its display name) so the code identifier matches the new affiliation.
update rule_profiles
set
  code = 'PAFI-2024',
  name = 'People''s Arm Wrestling Federation India 2024'
where code = 'IAFF-2024';

-- ════════════════════════════════════════════════════════════════════════════
-- 0022_double_elim_brackets.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0022 — first-class double-elimination support on fixtures.
--
-- Until this migration, `fixtures` carried only `(round_no, match_no)` and an
-- optional `next_match_id` pointer. That was enough for single-elimination,
-- but the schema's documented default (`events.bracket_format = 'double_elim'`)
-- could not actually be represented: a double-elim draw needs a second
-- (losers') bracket plus a grand final, and each match needs to know where
-- BOTH the winner AND the loser go next.
--
-- This migration is additive and back-compatible with existing rows:
--   * `bracket_side` defaults to 'W' so historical single-elim fixtures keep
--     working without a backfill.
--   * The (event, category, round, match) unique key is replaced with one
--     that also keys on `bracket_side`, so the same (round, match) coords
--     can exist on the W / L / GF sides simultaneously.
--   * `next_*` and `loser_next_*` are nullable — single-elim leaves the
--     loser routing columns null and walks the winner via the implicit
--     `(round_no+1, ceil(match_no/2))` rule.

alter table fixtures
  add column if not exists bracket_side text not null default 'W';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_bracket_side_check'
  ) then
    alter table fixtures
      add constraint fixtures_bracket_side_check
      check (bracket_side in ('W','L','GF'));
  end if;
end $$;

-- Replace the legacy unique constraint with one that includes bracket_side.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'fixtures_event_id_category_code_round_no_match_no_key'
  ) then
    alter table fixtures
      drop constraint fixtures_event_id_category_code_round_no_match_no_key;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fixtures_event_cat_side_round_match_key'
  ) then
    alter table fixtures
      add constraint fixtures_event_cat_side_round_match_key
      unique (event_id, category_code, bracket_side, round_no, match_no);
  end if;
end $$;

-- Explicit routing coordinates. We don't reuse `next_match_id` (a FK pointer)
-- because populating it requires a second insert pass; coordinates can be
-- written in one shot and resolved at match-completion time.
alter table fixtures
  add column if not exists next_round_no int,
  add column if not exists next_match_no int,
  add column if not exists next_bracket_side text,
  add column if not exists loser_next_round_no int,
  add column if not exists loser_next_match_no int,
  add column if not exists loser_next_bracket_side text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_next_bracket_side_check'
  ) then
    alter table fixtures
      add constraint fixtures_next_bracket_side_check
      check (next_bracket_side is null or next_bracket_side in ('W','L','GF'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_loser_next_bracket_side_check'
  ) then
    alter table fixtures
      add constraint fixtures_loser_next_bracket_side_check
      check (loser_next_bracket_side is null or loser_next_bracket_side in ('W','L','GF'));
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0022_id_card_text_sizes.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0022_id_card_text_sizes.sql
-- Adds optional override font sizes (in PDF points) for ID-card org name &
-- event title strips so organisers can tune typography per event without
-- touching code. Null means "use the IdCardSheet default" (7.5pt org,
-- 8.5pt title) so existing rows keep their look.
alter table public.events
  add column if not exists id_card_org_name_size    smallint,
  add column if not exists id_card_event_title_size smallint;

-- Sanity bounds — keep sizes in a sensible printable range.
alter table public.events
  drop constraint if exists events_id_card_org_name_size_chk;
alter table public.events
  add constraint events_id_card_org_name_size_chk
    check (id_card_org_name_size is null
        or (id_card_org_name_size between 5 and 14));

alter table public.events
  drop constraint if exists events_id_card_event_title_size_chk;
alter table public.events
  add constraint events_id_card_event_title_size_chk
    check (id_card_event_title_size is null
        or (id_card_event_title_size between 6 and 16));

-- ════════════════════════════════════════════════════════════════════════════
-- 0023_event_bracket_format.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0023 — bracket_format actually lives on `events`.
--
-- Migration 0002 originally put `bracket_format` on `categories`, but the
-- active app uses category_code strings (e.g. 'M-−80 kg-R') on
-- entries/fixtures and never populates the categories table. The fixtures
-- generator (web/src/app/api/fixtures/generate/route.ts) reads
-- `events.bracket_format` — so we add the column here, default it to
-- 'double_elim' (matching the rule_profiles.bracket_default in 0001), and
-- backfill all existing rows.

alter table events
  add column if not exists bracket_format text not null default 'double_elim';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_bracket_format_check'
  ) then
    alter table events
      add constraint events_bracket_format_check
      check (bracket_format in ('double_elim','single_elim','round_robin'));
  end if;
end $$;

-- Existing rows already get the default via the column add, but be explicit.
update events set bracket_format = 'double_elim' where bracket_format is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 0024_fixtures_best_of.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0024_fixtures_best_of.sql
-- Add per-fixture `best_of` count so the bracket builder can mark the
-- Grand Final as best-of-three (and leave room for other formats — e.g.
-- WAF rules allow some pro-circuit GFs to be best-of-five). Existing rows
-- default to 1 (single match). The match runner / paper score card decide
-- a winner once a player reaches ceil(best_of / 2) game wins.
alter table fixtures
  add column if not exists best_of smallint not null default 1
    check (best_of in (1, 3, 5));

-- Backfill: mark any pre-existing GF rows as best-of-3 so the new print /
-- PDF rendering shows the correct number of game slots without requiring
-- a fixture regeneration.
update fixtures set best_of = 3 where bracket_side = 'GF' and best_of <> 3;

-- ════════════════════════════════════════════════════════════════════════════
-- 0024_payment_installments.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0024_payment_installments.sql
--
-- Allow a single `payments` row to be settled in multiple installments
-- (e.g. ₹500 fee → ₹200 cash now, ₹300 UPI later) and to be partially
-- waived ("collect ₹200, waive the rest").
--
-- The existing `payments` table keeps its meaning:
--   - `amount_inr`  = total fee owed for this registration (mutable; can
--                     be adjusted by /api/admin/payments/[id]/adjust-total)
--   - `status`      = denormalised flag, 'verified' iff sum(active
--                     collections) >= amount_inr, otherwise 'pending'
--                     ('rejected' is still settable explicitly).
--
-- The new `payment_collections` table is the source of truth for who
-- collected how much when. Soft-reverse via `reversed_at` so we keep
-- the full audit trail when an operator undoes an accidental verify.

create table if not exists payment_collections (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references payments(id) on delete cascade,
  amount_inr      int  not null check (amount_inr >= 0),
  method          text not null check (method in ('manual_upi','razorpay','cash','waiver')),
  reference       text,
  collected_by    uuid references profiles(id),
  collected_at    timestamptz not null default now(),
  reversed_at     timestamptz,
  reversed_by     uuid references profiles(id),
  reversal_reason text
);

create index if not exists payment_collections_payment_idx
  on payment_collections(payment_id, collected_at desc);

-- Active = not reversed. Used by the API to compute "is this payment
-- fully collected?".
create index if not exists payment_collections_active_idx
  on payment_collections(payment_id)
  where reversed_at is null;

-- Backfill: every payment that is currently `verified` becomes a single
-- collection covering its full amount, attributed to whoever verified it.
-- Pending / rejected payments get nothing — the operator console will
-- start fresh once they begin collecting.
insert into payment_collections
  (payment_id, amount_inr, method, reference, collected_by, collected_at)
select
  p.id,
  p.amount_inr,
  p.method,
  p.notes,
  p.verified_by,
  coalesce(p.verified_at, p.created_at, now())
from payments p
where p.status = 'verified'
  and not exists (
    select 1 from payment_collections pc where pc.payment_id = p.id
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 0025_assign_chest_no_trigger.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0025_assign_chest_no_trigger.sql
-- Auto-assign chest_no per event on registration insert.
--
-- Until now neither /api/register nor /api/admin/registrations/bulk-row
-- assigned a chest_no — only the seed script did. Real registrations were
-- shipping with chest_no = NULL, which is why the bulk-register desk
-- showed every saved row without a "#NN" badge and the printable lists
-- (nominal sheet, ID cards, weigh-in queue) all rendered "—" instead of
-- a number.
--
-- We assign in a BEFORE INSERT trigger so the value is visible to the
-- INSERT … RETURNING that the API uses, and per-event uniqueness is
-- still guarded by the existing partial unique index
-- (registrations_event_chest_no_idx).
--
-- Concurrency: pg_advisory_xact_lock on the event id serialises the
-- max() lookup across concurrent operator-desk inserts so two rows can't
-- pick the same number. The lock is released at COMMIT.

create or replace function assign_chest_no() returns trigger
language plpgsql as $$
begin
  if NEW.chest_no is null and NEW.event_id is not null then
    perform pg_advisory_xact_lock(hashtext('chest_no:' || NEW.event_id::text));
    select coalesce(max(chest_no), 0) + 1
      into NEW.chest_no
      from registrations
     where event_id = NEW.event_id;
  end if;
  return NEW;
end
$$;

drop trigger if exists registrations_assign_chest_no on registrations;
create trigger registrations_assign_chest_no
  before insert on registrations
  for each row execute function assign_chest_no();

-- Backfill any existing rows that were inserted before this trigger
-- existed. Numbers are assigned in created_at order per event.
with ranked as (
  select id,
         row_number() over (
           partition by event_id
           order by created_at, id
         )
         + coalesce(
             (select max(chest_no) from registrations r2 where r2.event_id = registrations.event_id),
             0
           ) as new_chest
    from registrations
   where chest_no is null
)
update registrations r
   set chest_no = ranked.new_chest
  from ranked
 where r.id = ranked.id;

-- ════════════════════════════════════════════════════════════════════════════
-- 0026_district_team_chest_blocks.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0026_district_team_chest_blocks.sql
-- District/team-aware chest number allocator.
--
-- Replaces the simple max+1 logic from 0025 with a "100-block" scheme:
--
--   group_key = district  (fallback: 'team:'||team, else '__unassigned__')
--   base      = first free multiple of 100 (>=100), assigned per group
--               on first sight, recorded in chest_blocks
--   chest_no  = base + serial, serial = 1..99 within the block
--
-- When a group's block fills (serial > 99), a NEW base is allocated for
-- that same group (next free multiple of 100 in the event). So District 1
-- could own 100..199 AND 1300..1399 if 12 other groups arrived in between.
-- Decoding "which group is chest 234?" is always
--   select group_key from chest_blocks
--    where event_id = ? and base = (234/100)*100
--
-- This satisfies "from the chest number you should know which district".

create table if not exists chest_blocks (
  event_id   uuid not null references events(id) on delete cascade,
  group_key  text not null,
  base       int  not null check (base >= 100 and base % 100 = 0),
  created_at timestamptz not null default now(),
  primary key (event_id, base)
);

create index if not exists chest_blocks_event_group_idx
  on chest_blocks(event_id, group_key, base);

create or replace function chest_group_key(p_district text, p_team text)
returns text language sql immutable as $$
  select coalesce(
    nullif(btrim(p_district), ''),
    case
      when nullif(btrim(p_team), '') is not null then 'team:' || btrim(p_team)
      else null
    end,
    '__unassigned__'
  );
$$;

create or replace function assign_chest_no() returns trigger
language plpgsql as $$
declare
  v_key      text;
  v_base     int;
  v_max      int;
  v_assigned boolean := false;
begin
  if NEW.chest_no is not null or NEW.event_id is null then
    return NEW;
  end if;

  v_key := chest_group_key(NEW.district, NEW.team);

  -- Serialise per-event allocation across concurrent inserts.
  perform pg_advisory_xact_lock(hashtext('chest_no:' || NEW.event_id::text));

  -- Try existing blocks for this group, oldest first.
  for v_base in
    select base from chest_blocks
     where event_id = NEW.event_id and group_key = v_key
     order by base
  loop
    select coalesce(max(chest_no), v_base - 1)
      into v_max
      from registrations
     where event_id = NEW.event_id
       and chest_no between v_base and v_base + 99;
    if v_max < v_base + 99 then
      NEW.chest_no := v_max + 1;
      v_assigned := true;
      exit;
    end if;
  end loop;

  if not v_assigned then
    -- Allocate a fresh 100-block for this group.
    select coalesce(max(base), 0) + 100
      into v_base
      from chest_blocks
     where event_id = NEW.event_id;
    if v_base < 100 then v_base := 100; end if;
    insert into chest_blocks(event_id, group_key, base)
      values (NEW.event_id, v_key, v_base);
    NEW.chest_no := v_base + 1;
  end if;

  return NEW;
end
$$;

drop trigger if exists registrations_assign_chest_no on registrations;
create trigger registrations_assign_chest_no
  before insert on registrations
  for each row execute function assign_chest_no();

-- ── Backfill: renumber every existing registration under the new scheme.
-- Re-runs the allocation in created_at order per event so groups get
-- 100-blocks in their first-appearance order. Only the seed/populate
-- events have meaningful data here; no production cards have been
-- printed against the 0025 numbers (assigned only minutes ago).
do $$
declare
  r           record;
  v_key       text;
  v_base      int;
  v_max       int;
  v_assigned  boolean;
begin
  update registrations set chest_no = null where chest_no is not null;
  delete from chest_blocks;

  for r in
    select id, event_id, district, team
      from registrations
     where event_id is not null
     order by event_id, created_at, id
  loop
    v_key      := chest_group_key(r.district, r.team);
    v_assigned := false;

    for v_base in
      select base from chest_blocks
       where event_id = r.event_id and group_key = v_key
       order by base
    loop
      select coalesce(max(chest_no), v_base - 1)
        into v_max
        from registrations
       where event_id = r.event_id
         and chest_no between v_base and v_base + 99;
      if v_max < v_base + 99 then
        update registrations set chest_no = v_max + 1 where id = r.id;
        v_assigned := true;
        exit;
      end if;
    end loop;

    if not v_assigned then
      select coalesce(max(base), 0) + 100
        into v_base
        from chest_blocks
       where event_id = r.event_id;
      if v_base is null or v_base < 100 then v_base := 100; end if;
      insert into chest_blocks(event_id, group_key, base)
        values (r.event_id, v_key, v_base);
      update registrations set chest_no = v_base + 1 where id = r.id;
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0027_payment_collections_payer_label.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Distinguish "athlete paid for themselves" from "district / team / sponsor
-- treasurer handed over a pooled amount that covered some athletes". The
-- bulk pool flow stamps every collection it creates with the source label
-- (typically the district / team name) so the audit log + the row UI can
-- show a small "By Trichy DC" chip.

alter table payment_collections
  add column if not exists payer_label text;

create index if not exists payment_collections_payer_label_idx
  on payment_collections (payer_label)
  where payer_label is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 0028_payment_summary_view.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0028_payment_summary_view.sql
--
-- Single source of truth for installment-aware payment math.
--
-- Before this migration, two surfaces still used the legacy
-- "is the payments row marked verified?" semantics:
--   * event_dashboard RPC (totals + per-district aggregates)
--   * event_payment_totals / event_district_payment_totals views
-- Those under-counted partial collections (₹200 collected of ₹500 still
-- pending was reported as ₹0 paid / ₹500 due) and ignored payer_label.
--
-- We introduce a single view `payment_summary` that mirrors the TS
-- helper `summarisePayment` in web/src/lib/payments/collections.ts.
-- Every reader of payment math (RPCs, views, SSR loaders) now goes
-- through this view so the rules live in exactly one place. The TS
-- helper is kept only because it operates pre-insert (during a
-- transaction, before the row is visible to the view) — its output
-- must match this view for the same inputs. Tests in
-- collections.test.ts pin the TS side; this view's expressions pin
-- the SQL side.

create or replace view payment_summary as
  select p.id                                                     as payment_id,
         p.registration_id,
         r.event_id,
         p.amount_inr                                             as total_inr,
         p.status                                                 as raw_status,
         coalesce(c.collected_inr, 0)::int                        as collected_inr,
         greatest(0, p.amount_inr - coalesce(c.collected_inr, 0))::int
                                                                  as remaining_inr,
         case
           when p.status = 'rejected' then 'rejected'
           when p.amount_inr > 0
                and coalesce(c.collected_inr, 0) >= p.amount_inr
             then 'verified'
           else 'pending'
         end                                                      as derived_status,
         c.latest_payer_label
    from payments p
    join registrations r on r.id = p.registration_id
    left join lateral (
      select
        coalesce(sum(pc.amount_inr) filter (where pc.reversed_at is null), 0)::int
          as collected_inr,
        (select pc2.payer_label
           from payment_collections pc2
          where pc2.payment_id = p.id
            and pc2.reversed_at is null
            and pc2.payer_label is not null
          order by pc2.collected_at desc
          limit 1)
          as latest_payer_label
        from payment_collections pc
       where pc.payment_id = p.id
    ) c on true;

comment on view payment_summary is
  'Per-payment installment-aware snapshot. Single source of truth for '
  '"how much has been collected, how much is left, what is the effective '
  'status". Mirrors web/src/lib/payments/collections.ts#summarisePayment.';

-- Helper view: per-event totals. Re-uses payment_summary so it cannot
-- drift from the RPC.
create or replace view event_payment_totals as
  select event_id,
         coalesce(sum(collected_inr), 0)::int                          as collected_inr,
         coalesce(sum(remaining_inr) filter (where derived_status = 'pending'), 0)::int
                                                                       as pending_inr,
         coalesce(sum(total_inr) filter (where raw_status = 'rejected'), 0)::int
                                                                       as rejected_inr,
         count(*) filter (where derived_status = 'verified')::int      as collected_n,
         count(*) filter (where derived_status = 'pending')::int       as pending_n
    from payment_summary
   group by event_id;

-- Per-event, per-district totals. Mirrors the RPC's district aggregate;
-- one payment per registration is the norm, but if a registration has
-- multiple payments rows we pick the latest by payment_id as before.
create or replace view event_district_payment_totals as
  select r.event_id,
         coalesce(r.district, '—') as district,
         count(*)::int                                                              as athletes_n,
         coalesce(sum(s.collected_inr), 0)::int                                     as collected_inr,
         coalesce(sum(s.remaining_inr) filter (where s.derived_status = 'pending'), 0)::int
                                                                                    as pending_inr,
         count(*) filter (where s.derived_status = 'verified')::int                 as collected_n,
         count(*) filter (where s.derived_status = 'pending')::int                  as pending_n
    from registrations r
    left join lateral (
      select * from payment_summary
       where registration_id = r.id
       order by payment_id desc
       limit 1
    ) s on true
   group by r.event_id, coalesce(r.district, '—');

-- Rewrite the dashboard RPC to read from payment_summary too, so the
-- single-RTT dashboard fetch sees partial collections correctly.
create or replace function public.event_dashboard(p_id_or_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_counts jsonb;
  v_totals jsonb;
  v_districts jsonb;
begin
  if p_id_or_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_event from events where id = p_id_or_slug::uuid;
  else
    select * into v_event from events where slug = p_id_or_slug;
  end if;
  if not found then return null; end if;

  select jsonb_build_object(
    'total_regs',    (select count(*) from registrations where event_id = v_event.id),
    'pending_pays',  (select count(*) from payment_summary
                       where event_id = v_event.id and derived_status = 'pending'),
    'verified_pays', (select count(*) from payment_summary
                       where event_id = v_event.id and derived_status = 'verified')
  ) into v_counts;

  select jsonb_build_object(
    'collected_inr', coalesce(sum(collected_inr), 0),
    'pending_inr',   coalesce(sum(remaining_inr) filter (where derived_status = 'pending'), 0),
    'collected_n',   count(*) filter (where derived_status = 'verified'),
    'pending_n',     count(*) filter (where derived_status = 'pending')
  ) into v_totals
  from payment_summary
  where event_id = v_event.id;

  select coalesce(jsonb_agg(d order by d->>'athletes_n' desc), '[]'::jsonb) into v_districts
  from (
    select jsonb_build_object(
      'district',      coalesce(r.district, '—'),
      'athletes_n',    count(*),
      'collected_inr', coalesce(sum(s.collected_inr), 0),
      'pending_inr',   coalesce(sum(s.remaining_inr) filter (where s.derived_status = 'pending'), 0),
      'collected_n',   count(*) filter (where s.derived_status = 'verified'),
      'pending_n',     count(*) filter (where s.derived_status = 'pending')
    ) as d
    from registrations r
    left join lateral (
      select * from payment_summary
       where registration_id = r.id
       order by payment_id desc
       limit 1
    ) s on true
    where r.event_id = v_event.id
    group by coalesce(r.district, '—')
  ) sub;

  return jsonb_build_object(
    'event',     to_jsonb(v_event),
    'counts',    v_counts,
    'totals',    v_totals,
    'districts', v_districts
  );
end;
$$;

revoke all on function public.event_dashboard(text) from public;
grant execute on function public.event_dashboard(text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 0029_registration_checkin_status.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0029_registration_checkin_status.sql
--
-- Splits "did the athlete weigh in?" off registrations.status so the
-- lifecycle / discipline / check-in / payment dimensions stop colliding
-- in a single column.
--
-- Why a new column instead of repurposing registrations.status:
--   * Existing readers (filters like .in("status", ["paid","weighed_in"]),
--     RPCs, views) keep working without a coordinated cutover.
--   * The new column has exactly one writer — a trigger on weigh_ins —
--     so checkin_status cannot drift from the authoritative count of
--     weigh_ins rows.
--
-- After this migration, application code prefers checkin_status when
-- asking "did this athlete check in / weigh in?", and registrations.status
-- continues to act as a denormalised mirror only for legacy callsites.

alter table registrations
  add column if not exists checkin_status text not null default 'not_arrived'
    check (checkin_status in ('not_arrived', 'weighed_in', 'no_show'));

-- Backfill from existing data. A row counts as weighed_in if either the
-- legacy mirror says so OR there is at least one weigh_ins row for it.
update registrations r
   set checkin_status = 'weighed_in'
 where checkin_status <> 'weighed_in'
   and (
     r.status = 'weighed_in'
     or exists (select 1 from weigh_ins w where w.registration_id = r.id)
   );

-- Single writer for checkin_status going forward: the weigh-in trigger.
-- Idempotent — running this insert twice never bounces the column.
create or replace function registrations_mark_weighed_in()
returns trigger
language plpgsql
as $$
begin
  update registrations
     set checkin_status = 'weighed_in'
   where id = new.registration_id
     and checkin_status <> 'weighed_in';
  return new;
end;
$$;

drop trigger if exists weigh_ins_mark_checkin on weigh_ins;
create trigger weigh_ins_mark_checkin
  after insert on weigh_ins
  for each row execute function registrations_mark_weighed_in();

create index if not exists registrations_event_checkin_idx
  on registrations (event_id, checkin_status);

comment on column registrations.checkin_status is
  'Has the athlete weighed in? Auto-maintained by the '
  'weigh_ins_mark_checkin trigger. registrations.status is kept as a '
  'legacy mirror for backward compatibility.';

-- ════════════════════════════════════════════════════════════════════════════
-- 0030_fixture_runtime.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0030_fixture_runtime.sql
-- Live match-day runtime columns on `fixtures` + atomic auto-advance RPC.
--
-- Until now `fixtures` only stored `winner_entry_id` (set when an operator
-- recorded a result) and the planned routing coordinates from 0022. There
-- was no notion of a match being "in progress" vs "scheduled", no game
-- score for best-of-N grand finals, no method, no started/completed
-- timestamps and no atomic way to commit the result + update the next
-- slot in one transaction. This migration adds those runtime columns and
-- one RPC, `apply_fixture_complete`, that the new operator console calls
-- to close a match and auto-advance both the winner (W next slot) and,
-- in double-elim, the loser (L drop slot).
--
-- Backwards compatible: existing rows pick up `status='scheduled'` (or
-- `'completed'` if `winner_entry_id` was already set), and existing bye
-- fixtures (one entry NULL) are auto-completed in the same transaction
-- so the new operator UI never shows them as actionable.

------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------
-- Some live DBs were rebuilt without the original 0003 winner_entry_id +
-- created_at columns, so include both here as no-ops on schemas that
-- already have them.
alter table fixtures
  add column if not exists winner_entry_id uuid references entries(id) on delete set null,
  add column if not exists created_at      timestamptz not null default now(),
  add column if not exists status          text not null default 'scheduled',
  add column if not exists score_a         smallint not null default 0,
  add column if not exists score_b         smallint not null default 0,
  add column if not exists method          text,
  add column if not exists mat_no          smallint,
  add column if not exists started_at      timestamptz,
  add column if not exists completed_at    timestamptz,
  add column if not exists updated_by      uuid references profiles(id) on delete set null,
  add column if not exists updated_at      timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_status_check'
  ) then
    alter table fixtures
      add constraint fixtures_status_check
      check (status in ('scheduled','in_progress','completed','void'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_method_check'
  ) then
    alter table fixtures
      add constraint fixtures_method_check
      check (method is null or method in
        ('points','pin','disqualification','walkover','forfeit','injury'));
  end if;
end $$;

create index if not exists fixtures_event_status_idx
  on fixtures(event_id, status, mat_no, round_no, match_no);

------------------------------------------------------------------------
-- 2. Backfill — derive status from existing data
------------------------------------------------------------------------
-- Already-recorded winners → completed.
update fixtures
   set status = 'completed',
       completed_at = coalesce(completed_at, created_at)
 where winner_entry_id is not null
   and status = 'scheduled';

-- Bye fixtures (exactly one entry present) auto-complete using the
-- present entry as winner. Walkover method.
update fixtures f
   set winner_entry_id = coalesce(f.entry_a_id, f.entry_b_id),
       status          = 'completed',
       method          = 'walkover',
       completed_at    = coalesce(f.completed_at, f.created_at)
 where f.status = 'scheduled'
   and f.winner_entry_id is null
   and ((f.entry_a_id is null) <> (f.entry_b_id is null));

------------------------------------------------------------------------
-- 3. apply_fixture_complete RPC
--
-- Atomically:
--   * stamps the closing match (status, winner, scores, method, ts, actor)
--   * resolves winner into next_round_no/next_match_no/next_bracket_side slot
--   * resolves loser  into loser_next_*  slot if present
--   * recursively auto-completes any downstream slot that becomes a bye
--     (the other side filled but its match is still scheduled with
--      no opposing entry and no incoming feeder)
--
-- Conflict rules (raised as `raise exception` so PostgREST returns 4xx):
--   * fixture already completed with a different winner → P0001 conflict
--   * a downstream match already in_progress/completed → P0002 lock
------------------------------------------------------------------------
create or replace function apply_fixture_complete(
  p_fixture_id uuid,
  p_winner     char,         -- 'A' or 'B'
  p_score_a    int,
  p_score_b    int,
  p_method     text,
  p_actor      uuid
) returns table (
  affected_id     uuid,
  bracket_side    text,
  round_no        int,
  match_no        int,
  status          text,
  winner_entry_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fx              fixtures%rowtype;
  v_winner_entry_id uuid;
  v_loser_entry_id  uuid;
  v_next_id         uuid;
  v_loser_next_id   uuid;
  v_now             timestamptz := now();
begin
  if p_winner not in ('A','B') then
    raise exception 'invalid winner %', p_winner using errcode = '22023';
  end if;

  select * into v_fx from fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'fixture % not found', p_fixture_id using errcode = 'P0003';
  end if;

  if v_fx.status = 'completed' and v_fx.winner_entry_id is not null then
    if (p_winner = 'A' and v_fx.winner_entry_id = v_fx.entry_a_id)
       or (p_winner = 'B' and v_fx.winner_entry_id = v_fx.entry_b_id) then
      -- Idempotent re-submit, same winner. No-op.
      return query
        select v_fx.id, v_fx.bracket_side, v_fx.round_no, v_fx.match_no,
               v_fx.status, v_fx.winner_entry_id;
      return;
    else
      raise exception 'fixture % already completed with different winner', p_fixture_id
        using errcode = 'P0001';
    end if;
  end if;

  if p_winner = 'A' then
    v_winner_entry_id := v_fx.entry_a_id;
    v_loser_entry_id  := v_fx.entry_b_id;
  else
    v_winner_entry_id := v_fx.entry_b_id;
    v_loser_entry_id  := v_fx.entry_a_id;
  end if;

  if v_winner_entry_id is null then
    raise exception 'fixture % side % has no entry', p_fixture_id, p_winner
      using errcode = '22023';
  end if;

  update fixtures
     set status          = 'completed',
         winner_entry_id = v_winner_entry_id,
         score_a         = coalesce(p_score_a, score_a),
         score_b         = coalesce(p_score_b, score_b),
         method          = coalesce(p_method, method),
         completed_at    = coalesce(completed_at, v_now),
         started_at      = coalesce(started_at, v_now),
         updated_by      = p_actor,
         updated_at      = v_now
   where id = p_fixture_id;

  -- Resolve winner → next slot.
  if v_fx.next_round_no is not null and v_fx.next_match_no is not null then
    select id into v_next_id
      from fixtures
     where event_id      = v_fx.event_id
       and category_code = v_fx.category_code
       and bracket_side  = coalesce(v_fx.next_bracket_side, v_fx.bracket_side)
       and round_no      = v_fx.next_round_no
       and match_no      = v_fx.next_match_no
     for update;

    if v_next_id is not null then
      perform fill_next_slot(v_next_id, v_fx.match_no, v_winner_entry_id, p_actor, v_now);
    end if;
  end if;

  -- Resolve loser → drop slot (double-elim only).
  if v_loser_entry_id is not null
     and v_fx.loser_next_round_no is not null
     and v_fx.loser_next_match_no is not null then
    select id into v_loser_next_id
      from fixtures
     where event_id      = v_fx.event_id
       and category_code = v_fx.category_code
       and bracket_side  = coalesce(v_fx.loser_next_bracket_side, 'L')
       and round_no      = v_fx.loser_next_round_no
       and match_no      = v_fx.loser_next_match_no
     for update;

    if v_loser_next_id is not null then
      perform fill_next_slot(v_loser_next_id, v_fx.match_no, v_loser_entry_id, p_actor, v_now);
    end if;
  end if;

  return query
    select f.id, f.bracket_side, f.round_no, f.match_no,
           f.status, f.winner_entry_id
      from fixtures f
     where f.id in (
       select p_fixture_id
       union all select v_next_id where v_next_id is not null
       union all select v_loser_next_id where v_loser_next_id is not null
     );
end;
$$;

------------------------------------------------------------------------
-- fill_next_slot — helper used by apply_fixture_complete.
--
-- Picks side A or B in the downstream fixture based on the parity of
-- the source `match_no` (odd → A, even → B), refusing to overwrite an
-- existing entry on that side. Auto-completes the slot as a walkover
-- if it ends up with one entry and no possibility of a second feeder.
------------------------------------------------------------------------
create or replace function fill_next_slot(
  p_next_id     uuid,
  p_source_match int,
  p_entry_id    uuid,
  p_actor       uuid,
  p_now         timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next         fixtures%rowtype;
  v_target_side  char;       -- 'A' or 'B'
  v_existing     uuid;
  v_other        uuid;
  v_feeder_count int;
begin
  select * into v_next from fixtures where id = p_next_id for update;
  if not found then return; end if;

  if v_next.status in ('in_progress','completed') then
    raise exception 'downstream fixture % already %', v_next.id, v_next.status
      using errcode = 'P0002';
  end if;

  v_target_side := case when (p_source_match % 2) = 1 then 'A' else 'B' end;
  if v_target_side = 'A' then
    v_existing := v_next.entry_a_id;
    v_other    := v_next.entry_b_id;
  else
    v_existing := v_next.entry_b_id;
    v_other    := v_next.entry_a_id;
  end if;

  if v_existing is not null and v_existing <> p_entry_id then
    raise exception 'downstream fixture % side % already filled with different entry',
      v_next.id, v_target_side using errcode = 'P0001';
  end if;

  if v_target_side = 'A' then
    update fixtures set entry_a_id = p_entry_id, updated_by = p_actor, updated_at = p_now
      where id = p_next_id;
  else
    update fixtures set entry_b_id = p_entry_id, updated_by = p_actor, updated_at = p_now
      where id = p_next_id;
  end if;

  -- Bye auto-complete: only one feeder exists for this slot AND the
  -- other side will never be filled (no remaining feeder pointing here).
  if v_other is null then
    select count(*) into v_feeder_count
      from fixtures src
     where src.event_id      = v_next.event_id
       and src.category_code = v_next.category_code
       and src.status        <> 'completed'
       and src.id            <> p_next_id
       and (
         (src.next_round_no = v_next.round_no
          and src.next_match_no = v_next.match_no
          and coalesce(src.next_bracket_side, src.bracket_side) = v_next.bracket_side)
         or
         (src.loser_next_round_no = v_next.round_no
          and src.loser_next_match_no = v_next.match_no
          and coalesce(src.loser_next_bracket_side, 'L') = v_next.bracket_side)
       );

    if v_feeder_count = 0 then
      update fixtures
         set status          = 'completed',
             winner_entry_id = p_entry_id,
             method          = 'walkover',
             completed_at    = p_now,
             started_at      = coalesce(started_at, p_now),
             updated_by      = p_actor,
             updated_at      = p_now
       where id = p_next_id;
    end if;
  end if;
end;
$$;

grant execute on function apply_fixture_complete(uuid, char, int, int, text, uuid) to authenticated;
grant execute on function fill_next_slot(uuid, int, uuid, uuid, timestamptz) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 0031_fixture_runtime_lockdown.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0031_fixture_runtime_lockdown.sql
-- The two RPCs added in 0030 are only ever invoked from server routes
-- using the service-role key (which bypasses GRANTs). Exposing them on
-- /rest/v1/rpc to anon/authenticated would let any signed-in athlete
-- close other people's matches. Revoke EXECUTE so the public API
-- surface drops them.
revoke execute on function apply_fixture_complete(uuid, char, int, int, text, uuid) from anon, authenticated, public;
revoke execute on function fill_next_slot(uuid, int, uuid, uuid, timestamptz) from anon, authenticated, public;

-- ════════════════════════════════════════════════════════════════════════════
-- 0032_category_table_no.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0032_category_table_no.sql
-- A category is run on exactly one physical table at the venue. Track that
-- assignment as a simple integer on the category row. (The richer hub /
-- venue_tables model from 0002 is fine but unused for the solo-operator path.)
alter table categories
  add column if not exists table_no smallint
    check (table_no is null or table_no > 0);

create index if not exists categories_event_table_idx
  on categories(event_id, table_no);

-- ════════════════════════════════════════════════════════════════════════════
-- 0033_fixture_runtime_fix.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0033_fixture_runtime_fix.sql
-- Bug fix for 0030: `apply_fixture_complete` declared OUT columns named
-- `bracket_side`, `round_no`, `match_no`, `status`, `winner_entry_id`
-- which collided with same-named columns on `fixtures` inside the body
-- (Postgres raised `column reference "bracket_side" is ambiguous` the
-- moment we tried to actually use the function during a real match).
--
-- Fix: rename the OUT columns with an `out_` prefix so they cannot
-- shadow real table columns. The function signature (input params) is
-- unchanged, so callers in the app code don't need to change.
drop function if exists apply_fixture_complete(uuid, char, int, int, text, uuid);

create or replace function apply_fixture_complete(
  p_fixture_id uuid,
  p_winner     char,         -- 'A' or 'B'
  p_score_a    int,
  p_score_b    int,
  p_method     text,
  p_actor      uuid
) returns table (
  out_id              uuid,
  out_bracket_side    text,
  out_round_no        int,
  out_match_no        int,
  out_status          text,
  out_winner_entry_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fx              fixtures%rowtype;
  v_winner_entry_id uuid;
  v_loser_entry_id  uuid;
  v_next_id         uuid;
  v_loser_next_id   uuid;
  v_now             timestamptz := now();
begin
  if p_winner not in ('A','B') then
    raise exception 'invalid winner %', p_winner using errcode = '22023';
  end if;

  select * into v_fx from fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'fixture % not found', p_fixture_id using errcode = 'P0003';
  end if;

  if v_fx.status = 'completed' and v_fx.winner_entry_id is not null then
    if (p_winner = 'A' and v_fx.winner_entry_id = v_fx.entry_a_id)
       or (p_winner = 'B' and v_fx.winner_entry_id = v_fx.entry_b_id) then
      return query
        select v_fx.id, v_fx.bracket_side, v_fx.round_no, v_fx.match_no,
               v_fx.status, v_fx.winner_entry_id;
      return;
    else
      raise exception 'fixture % already completed with different winner', p_fixture_id
        using errcode = 'P0001';
    end if;
  end if;

  if p_winner = 'A' then
    v_winner_entry_id := v_fx.entry_a_id;
    v_loser_entry_id  := v_fx.entry_b_id;
  else
    v_winner_entry_id := v_fx.entry_b_id;
    v_loser_entry_id  := v_fx.entry_a_id;
  end if;

  if v_winner_entry_id is null then
    raise exception 'fixture % side % has no entry', p_fixture_id, p_winner
      using errcode = '22023';
  end if;

  update fixtures
     set status          = 'completed',
         winner_entry_id = v_winner_entry_id,
         score_a         = coalesce(p_score_a, score_a),
         score_b         = coalesce(p_score_b, score_b),
         method          = coalesce(p_method, method),
         completed_at    = coalesce(completed_at, v_now),
         started_at      = coalesce(started_at, v_now),
         updated_by      = p_actor,
         updated_at      = v_now
   where id = p_fixture_id;

  -- Resolve winner -> next slot. Qualify all column references with the
  -- table name so they cannot be misread as OUT params from the function
  -- signature.
  if v_fx.next_round_no is not null and v_fx.next_match_no is not null then
    select fixtures.id into v_next_id
      from fixtures
     where fixtures.event_id      = v_fx.event_id
       and fixtures.category_code = v_fx.category_code
       and fixtures.bracket_side  = coalesce(v_fx.next_bracket_side, v_fx.bracket_side)
       and fixtures.round_no      = v_fx.next_round_no
       and fixtures.match_no      = v_fx.next_match_no
     for update;

    if v_next_id is not null then
      perform fill_next_slot(v_next_id, v_fx.match_no, v_winner_entry_id, p_actor, v_now);
    end if;
  end if;

  -- Loser -> drop slot (double-elim only).
  if v_loser_entry_id is not null
     and v_fx.loser_next_round_no is not null
     and v_fx.loser_next_match_no is not null then
    select fixtures.id into v_loser_next_id
      from fixtures
     where fixtures.event_id      = v_fx.event_id
       and fixtures.category_code = v_fx.category_code
       and fixtures.bracket_side  = coalesce(v_fx.loser_next_bracket_side, 'L')
       and fixtures.round_no      = v_fx.loser_next_round_no
       and fixtures.match_no      = v_fx.loser_next_match_no
     for update;

    if v_loser_next_id is not null then
      perform fill_next_slot(v_loser_next_id, v_fx.match_no, v_loser_entry_id, p_actor, v_now);
    end if;
  end if;

  return query
    select f.id, f.bracket_side, f.round_no, f.match_no,
           f.status, f.winner_entry_id
      from fixtures f
     where f.id in (
       select p_fixture_id
       union all select v_next_id where v_next_id is not null
       union all select v_loser_next_id where v_loser_next_id is not null
     );
end;
$$;

revoke execute on function apply_fixture_complete(uuid, char, int, int, text, uuid)
  from anon, authenticated, public;

-- ════════════════════════════════════════════════════════════════════════════
-- 0034_fill_next_slot_fix.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0034_fill_next_slot_fix.sql
-- Bug: in the losers bracket, the slot at L.r.m has TWO feeders — one
-- "drop" from W.r.m and one "promote" from L.(r-1).m — both with
-- source match_no=1 (in small categories). The parity rule
-- (odd → A, even → B) routed both to side A and the second one to
-- complete its source raised P0001 "side A already filled with different
-- entry". The bracket builder doesn't store an explicit per-feeder side
-- hint.
--
-- Fix: in `fill_next_slot`, when the parity-target side is already
-- filled with a DIFFERENT entry AND the other side is empty, use the
-- other side. There are at most 2 feeders into any slot in single- and
-- double-elimination, so this disambiguates safely without changing the
-- schema or the builder.
create or replace function fill_next_slot(
  p_next_id     uuid,
  p_source_match int,
  p_entry_id    uuid,
  p_actor       uuid,
  p_now         timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next         fixtures%rowtype;
  v_target_side  char;       -- 'A' or 'B'
  v_existing     uuid;
  v_other        uuid;
  v_feeder_count int;
begin
  select * into v_next from fixtures where id = p_next_id for update;
  if not found then return; end if;

  if v_next.status in ('in_progress','completed') then
    raise exception 'downstream fixture % already %', v_next.id, v_next.status
      using errcode = 'P0002';
  end if;

  -- Parity rule first: odd source match → A, even → B.
  v_target_side := case when (p_source_match % 2) = 1 then 'A' else 'B' end;
  if v_target_side = 'A' then
    v_existing := v_next.entry_a_id;
    v_other    := v_next.entry_b_id;
  else
    v_existing := v_next.entry_b_id;
    v_other    := v_next.entry_a_id;
  end if;

  -- If the parity slot is taken by a different entry but the OTHER side
  -- is free, swap to the other side. This handles the LB-drop vs LB-
  -- promote collision where both feeders share match_no=1.
  if v_existing is not null and v_existing <> p_entry_id and v_other is null then
    if v_target_side = 'A' then
      v_target_side := 'B';
    else
      v_target_side := 'A';
    end if;
    v_existing := v_other;  -- now the prior other side is the new target (empty)
    v_other    := case when v_target_side = 'A' then v_next.entry_b_id else v_next.entry_a_id end;
  end if;

  if v_existing is not null and v_existing <> p_entry_id then
    raise exception 'downstream fixture % side % already filled with different entry',
      v_next.id, v_target_side using errcode = 'P0001';
  end if;

  if v_target_side = 'A' then
    update fixtures set entry_a_id = p_entry_id, updated_by = p_actor, updated_at = p_now
      where id = p_next_id;
  else
    update fixtures set entry_b_id = p_entry_id, updated_by = p_actor, updated_at = p_now
      where id = p_next_id;
  end if;

  -- Bye auto-complete: only one feeder ever exists for this slot AND
  -- the other side will never be filled.
  if v_other is null then
    select count(*) into v_feeder_count
      from fixtures src
     where src.event_id      = v_next.event_id
       and src.category_code = v_next.category_code
       and src.status        <> 'completed'
       and src.id            <> p_next_id
       and (
         (src.next_round_no = v_next.round_no
          and src.next_match_no = v_next.match_no
          and coalesce(src.next_bracket_side, src.bracket_side) = v_next.bracket_side)
         or
         (src.loser_next_round_no = v_next.round_no
          and src.loser_next_match_no = v_next.match_no
          and coalesce(src.loser_next_bracket_side, 'L') = v_next.bracket_side)
       );

    if v_feeder_count = 0 then
      update fixtures
         set status          = 'completed',
             winner_entry_id = p_entry_id,
             method          = 'walkover',
             completed_at    = p_now,
             started_at      = coalesce(started_at, p_now),
             updated_by      = p_actor,
             updated_at      = p_now
       where id = p_next_id;
    end if;
  end if;
end;
$$;

revoke execute on function fill_next_slot(uuid, int, uuid, uuid, timestamptz)
  from anon, authenticated, public;

-- ════════════════════════════════════════════════════════════════════════════
-- 0035_fill_next_slot_chain.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0035_fill_next_slot_chain.sql
-- Bug: fill_next_slot's auto-walkover branch (other side null AND no
-- remaining feeders) marks the downstream fixture completed but never
-- propagates the walkover winner to ITS own downstream slot. Result:
-- in losers brackets where one feeder is a bye, the chain breaks and
-- a category becomes unfinishable (orphaned winners, downstream
-- matches that look "done" but never actually played).
--
-- Fix: after an auto-walkover, recursively fill the winner-next slot
-- (and loser-next, which for walkovers is always null but we handle
-- it anyway).
create or replace function fill_next_slot(
  p_next_id     uuid,
  p_source_match int,
  p_entry_id    uuid,
  p_actor       uuid,
  p_now         timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next         fixtures%rowtype;
  v_target_side  char;
  v_existing     uuid;
  v_other        uuid;
  v_feeder_count int;
  v_after        fixtures%rowtype;
begin
  select * into v_next from fixtures where id = p_next_id for update;
  if not found then return; end if;

  if v_next.status in ('in_progress','completed') then
    raise exception 'downstream fixture % already %', v_next.id, v_next.status
      using errcode = 'P0002';
  end if;

  v_target_side := case when (p_source_match % 2) = 1 then 'A' else 'B' end;
  if v_target_side = 'A' then
    v_existing := v_next.entry_a_id;
    v_other    := v_next.entry_b_id;
  else
    v_existing := v_next.entry_b_id;
    v_other    := v_next.entry_a_id;
  end if;

  if v_existing is not null and v_existing <> p_entry_id and v_other is null then
    if v_target_side = 'A' then
      v_target_side := 'B';
    else
      v_target_side := 'A';
    end if;
    v_existing := v_other;
    v_other    := case when v_target_side = 'A' then v_next.entry_b_id else v_next.entry_a_id end;
  end if;

  if v_existing is not null and v_existing <> p_entry_id then
    raise exception 'downstream fixture % side % already filled with different entry',
      v_next.id, v_target_side using errcode = 'P0001';
  end if;

  if v_target_side = 'A' then
    update fixtures set entry_a_id = p_entry_id, updated_by = p_actor, updated_at = p_now
      where id = p_next_id;
  else
    update fixtures set entry_b_id = p_entry_id, updated_by = p_actor, updated_at = p_now
      where id = p_next_id;
  end if;

  if v_other is null then
    select count(*) into v_feeder_count
      from fixtures src
     where src.event_id      = v_next.event_id
       and src.category_code = v_next.category_code
       and src.status        not in ('completed','void')
       and src.id            <> p_next_id
       and (
         (src.next_round_no = v_next.round_no
          and src.next_match_no = v_next.match_no
          and coalesce(src.next_bracket_side, src.bracket_side) = v_next.bracket_side)
         or
         (src.loser_next_round_no = v_next.round_no
          and src.loser_next_match_no = v_next.match_no
          and coalesce(src.loser_next_bracket_side, 'L') = v_next.bracket_side)
       );

    if v_feeder_count = 0 then
      update fixtures
         set status          = 'completed',
             winner_entry_id = p_entry_id,
             method          = 'walkover',
             completed_at    = p_now,
             started_at      = coalesce(started_at, p_now),
             updated_by      = p_actor,
             updated_at      = p_now
       where id = p_next_id
       returning * into v_after;

      -- Chain walkover winner forward.
      if v_after.next_round_no is not null then
        perform fill_next_slot(
          (select id from fixtures
            where event_id      = v_after.event_id
              and category_code = v_after.category_code
              and bracket_side  = coalesce(v_after.next_bracket_side, v_after.bracket_side)
              and round_no      = v_after.next_round_no
              and match_no      = v_after.next_match_no
            limit 1),
          v_after.match_no,
          p_entry_id,
          p_actor,
          p_now
        );
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function fill_next_slot(uuid, int, uuid, uuid, timestamptz)
  from anon, authenticated, public;

-- ════════════════════════════════════════════════════════════════════════════
-- 0036_offline_entry_fee_and_channel.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0036_offline_entry_fee_and_channel.sql
--
-- Per-channel entry fees + explicit registration channel.
--
-- Until now every event had a single `entry_fee_default_inr` regardless of
-- whether the athlete registered online (public form, UPI proof) or
-- offline (counter desk, cash). Some federations charge a discount for
-- offline cash registrations (or, conversely, a small online surcharge).
--
-- This migration:
--   1. Adds `events.entry_fee_offline_inr int null`. NULL means "same as
--      online" so existing events keep their current behaviour.
--   2. Adds `registrations.channel text` with a CHECK for ('online','offline')
--      so we can record + report on how each athlete entered, and so the
--      counter desk can edit an online registration without flipping the fee.
--   3. Backfills `channel` from the existing `submitted_by` column
--      ('self' → online, anything else → offline).
--
-- Both columns are additive and nullable / defaulted, so the migration is
-- safe to apply without any application changes.

alter table public.events
  add column if not exists entry_fee_offline_inr int
    check (entry_fee_offline_inr is null or entry_fee_offline_inr >= 0);

comment on column public.events.entry_fee_offline_inr is
  'Per-hand fee charged at the counter desk for offline registrations. NULL means use entry_fee_default_inr (the online fee).';

alter table public.registrations
  add column if not exists channel text
    not null default 'offline'
    check (channel in ('online','offline'));

comment on column public.registrations.channel is
  'How the athlete registered: ''online'' (public form) or ''offline'' (counter desk). Drives which event fee column applies and is preserved across edits.';

-- Backfill: existing rows pre-migration had `submitted_by` = ''self'' for
-- public registrations, anything else (''bulk'') for counter-desk entries.
update public.registrations
   set channel = case when submitted_by = 'self' then 'online' else 'offline' end
 where channel = 'offline'  -- only touch defaulted rows
   and submitted_by = 'self';

-- ════════════════════════════════════════════════════════════════════════════
-- 0037_payment_summary_waivers.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0037_payment_summary_waivers.sql
--
-- Make payment math waiver-aware.
--
-- Until now `payment_summary.collected_inr` lumped real money
-- (cash / UPI / razorpay) together with waiver "collections", which
-- meant every downstream report — dashboard tiles, district card,
-- the printable Payment Report — could not tell an organiser:
--
--   * how much cash actually came in;
--   * how much was waived (and for how many athletes);
--   * what the effective billable is after waivers (= total − waived).
--
-- This migration splits the existing `collected_inr` into two flavours:
--
--   collected_inr = received_inr + waived_inr     (closes the bill,
--                                                  kept for status math)
--   received_inr  = sum(active collections where method <> 'waiver')
--   waived_inr    = sum(active collections where method  = 'waiver')
--
-- Downstream views + the dashboard RPC are widened with the new
-- columns. The status flip rule (collected >= total → verified)
-- is unchanged — a fully-waived payment is still "verified" from
-- the registration's point of view, just with received_inr = 0.

-- CREATE OR REPLACE VIEW can only append columns, not insert them in the
-- middle of the column list. We're inserting received_inr / waived_inr
-- between collected_inr and remaining_inr, so drop and recreate. CASCADE
-- because event_payment_totals + event_district_payment_totals depend on
-- it; both are recreated below.
drop view if exists event_district_payment_totals;
drop view if exists event_payment_totals;
drop view if exists payment_summary;

create view payment_summary as
  select p.id                                                     as payment_id,
         p.registration_id,
         r.event_id,
         p.amount_inr                                             as total_inr,
         p.status                                                 as raw_status,
         coalesce(c.collected_inr, 0)::int                        as collected_inr,
         coalesce(c.received_inr, 0)::int                         as received_inr,
         coalesce(c.waived_inr, 0)::int                           as waived_inr,
         greatest(0, p.amount_inr - coalesce(c.collected_inr, 0))::int
                                                                  as remaining_inr,
         case
           when p.status = 'rejected' then 'rejected'
           when p.amount_inr > 0
                and coalesce(c.collected_inr, 0) >= p.amount_inr
             then 'verified'
           else 'pending'
         end                                                      as derived_status,
         c.latest_payer_label
    from payments p
    join registrations r on r.id = p.registration_id
    left join lateral (
      select
        coalesce(sum(pc.amount_inr) filter (where pc.reversed_at is null), 0)::int
          as collected_inr,
        coalesce(sum(pc.amount_inr) filter (
          where pc.reversed_at is null and pc.method <> 'waiver'
        ), 0)::int
          as received_inr,
        coalesce(sum(pc.amount_inr) filter (
          where pc.reversed_at is null and pc.method = 'waiver'
        ), 0)::int
          as waived_inr,
        (select pc2.payer_label
           from payment_collections pc2
          where pc2.payment_id = p.id
            and pc2.reversed_at is null
            and pc2.payer_label is not null
          order by pc2.collected_at desc
          limit 1)
          as latest_payer_label
        from payment_collections pc
       where pc.payment_id = p.id
    ) c on true;

comment on view payment_summary is
  'Per-payment installment-aware snapshot, waiver-aware. '
  'collected_inr = received_inr + waived_inr; received is real money, '
  'waived is concession. Status flips to verified when collected >= total '
  '(i.e. either real money or waivers can close the bill). Mirrors '
  'web/src/lib/payments/collections.ts#summarisePayment.';

-- Per-event totals: split received vs waived; expose billable + effective
-- so the operator dashboard can show "₹X received of ₹Y effective
-- (₹Z waived from a ₹T billable)".
create or replace view event_payment_totals as
  select event_id,
         coalesce(sum(collected_inr), 0)::int                          as collected_inr,
         coalesce(sum(received_inr), 0)::int                           as received_inr,
         coalesce(sum(waived_inr), 0)::int                             as waived_inr,
         coalesce(sum(remaining_inr) filter (where derived_status = 'pending'), 0)::int
                                                                       as pending_inr,
         coalesce(sum(total_inr) filter (where raw_status = 'rejected'), 0)::int
                                                                       as rejected_inr,
         coalesce(sum(total_inr) filter (where raw_status <> 'rejected'), 0)::int
                                                                       as billable_inr,
         coalesce(sum(total_inr) filter (where raw_status <> 'rejected'), 0)::int
           - coalesce(sum(waived_inr), 0)::int                         as effective_inr,
         count(*) filter (where derived_status = 'verified')::int      as collected_n,
         count(*) filter (where derived_status = 'pending')::int       as pending_n,
         count(*) filter (where waived_inr > 0)::int                   as waived_n
    from payment_summary
   group by event_id;

-- Per-event, per-district totals. Same one-payment-per-registration
-- rule as before (latest payment_id).
create or replace view event_district_payment_totals as
  select r.event_id,
         coalesce(r.district, '—') as district,
         count(*)::int                                                              as athletes_n,
         coalesce(sum(s.collected_inr), 0)::int                                     as collected_inr,
         coalesce(sum(s.received_inr), 0)::int                                      as received_inr,
         coalesce(sum(s.waived_inr), 0)::int                                        as waived_inr,
         coalesce(sum(s.remaining_inr) filter (where s.derived_status = 'pending'), 0)::int
                                                                                    as pending_inr,
         count(*) filter (where s.derived_status = 'verified')::int                 as collected_n,
         count(*) filter (where s.derived_status = 'pending')::int                  as pending_n,
         count(*) filter (where s.waived_inr > 0)::int                              as waived_n
    from registrations r
    left join lateral (
      select * from payment_summary
       where registration_id = r.id
       order by payment_id desc
       limit 1
    ) s on true
   group by r.event_id, coalesce(r.district, '—');

-- Dashboard RPC: surface the new columns in the JSON payload.
-- `collected_inr` is preserved so any in-flight client cache still
-- renders something sensible while users hard-refresh.
create or replace function public.event_dashboard(p_id_or_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_counts jsonb;
  v_totals jsonb;
  v_districts jsonb;
begin
  if p_id_or_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_event from events where id = p_id_or_slug::uuid;
  else
    select * into v_event from events where slug = p_id_or_slug;
  end if;
  if not found then return null; end if;

  select jsonb_build_object(
    'total_regs',    (select count(*) from registrations where event_id = v_event.id),
    'pending_pays',  (select count(*) from payment_summary
                       where event_id = v_event.id and derived_status = 'pending'),
    'verified_pays', (select count(*) from payment_summary
                       where event_id = v_event.id and derived_status = 'verified')
  ) into v_counts;

  select jsonb_build_object(
    'collected_inr', coalesce(sum(collected_inr), 0),
    'received_inr',  coalesce(sum(received_inr), 0),
    'waived_inr',    coalesce(sum(waived_inr), 0),
    'pending_inr',   coalesce(sum(remaining_inr) filter (where derived_status = 'pending'), 0),
    'billable_inr',  coalesce(sum(total_inr) filter (where raw_status <> 'rejected'), 0),
    'effective_inr', coalesce(sum(total_inr) filter (where raw_status <> 'rejected'), 0)
                       - coalesce(sum(waived_inr), 0),
    'collected_n',   count(*) filter (where derived_status = 'verified'),
    'pending_n',     count(*) filter (where derived_status = 'pending'),
    'waived_n',      count(*) filter (where waived_inr > 0)
  ) into v_totals
  from payment_summary
  where event_id = v_event.id;

  select coalesce(jsonb_agg(d order by d->>'athletes_n' desc), '[]'::jsonb) into v_districts
  from (
    select jsonb_build_object(
      'district',      coalesce(r.district, '—'),
      'athletes_n',    count(*),
      'collected_inr', coalesce(sum(s.collected_inr), 0),
      'received_inr',  coalesce(sum(s.received_inr), 0),
      'waived_inr',    coalesce(sum(s.waived_inr), 0),
      'pending_inr',   coalesce(sum(s.remaining_inr) filter (where s.derived_status = 'pending'), 0),
      'collected_n',   count(*) filter (where s.derived_status = 'verified'),
      'pending_n',     count(*) filter (where s.derived_status = 'pending'),
      'waived_n',      count(*) filter (where s.waived_inr > 0)
    ) as d
    from registrations r
    left join lateral (
      select * from payment_summary
       where registration_id = r.id
       order by payment_id desc
       limit 1
    ) s on true
    where r.event_id = v_event.id
    group by coalesce(r.district, '—')
  ) sub;

  return jsonb_build_object(
    'event',     to_jsonb(v_event),
    'counts',    v_counts,
    'totals',    v_totals,
    'districts', v_districts
  );
end;
$$;

revoke all on function public.event_dashboard(text) from public;
grant execute on function public.event_dashboard(text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 0038_weight_bump_up.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0038_weight_bump_up.sql
--
-- Per-registration opt-in flag that lets a non-para athlete compete one
-- WAF weight bucket above the one their measured/declared weight would
-- normally place them in. Common ask in regional events: a 78-kg senior
-- who wants to enter the −80 kg bucket gets bumped to −85 kg instead.
--
-- Resolver ignores this flag for para entries (sometimes the bracket
-- has only one bucket, sometimes the medical class wouldn't allow it).
-- Bumping past the open bucket is a no-op (you're already at the top).
--
-- The column is non-null with default false so every existing row stays
-- in its current bucket until an operator explicitly flips the toggle.

alter table public.registrations
  add column if not exists weight_bump_up boolean not null default false;

comment on column public.registrations.weight_bump_up is
  'Non-para opt-in: place this athlete one weight bucket above the one their weight resolves to. No-op for para entries and at the open bucket.';

-- ════════════════════════════════════════════════════════════════════════════
-- 0039_registration_status_split.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0039_registration_status_split.sql
--
-- Finishes the job that 0029 (checkin_status) started: split the
-- overloaded `registrations.status` column into purpose-built
-- single-axis columns. Each new column has exactly one writer.
--
-- Before:
--   registrations.status ∈ {pending,paid,weighed_in,withdrawn,disqualified}
--   — conflated 4 axes (lifecycle, discipline, payment, check-in)
--   into one column so "weighed_in" beat "withdrawn" beat "paid" beat
--   "pending" purely by write order. A withdrawn athlete who had
--   weighed in could not be represented without losing one of the two
--   facts.
--
-- After this migration the four axes have dedicated homes:
--
--   lifecycle_status   active | withdrawn          (manual op action)
--   discipline_status  clear  | disqualified       (referee action)
--   checkin_status     not_arrived | weighed_in    (trigger on weigh_ins)
--                      | no_show
--   payment            payment_summary.derived_status (view, 0028+)
--
-- registrations.status is KEPT for back-compat — old code paths and any
-- analytics that still join on it keep working. Going forward, app
-- writers must NOT write 'paid' or 'weighed_in' to it; those signals
-- live on the dedicated columns. The check constraint is left untouched
-- so historical rows pass.

alter table registrations
  add column if not exists lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'withdrawn'));

alter table registrations
  add column if not exists discipline_status text not null default 'clear'
    check (discipline_status in ('clear', 'disqualified'));

-- Backfill from the legacy column. A row's lifecycle is "withdrawn"
-- iff the legacy column says so; otherwise active. Discipline is
-- "disqualified" iff the legacy column says so.
update registrations
   set lifecycle_status = 'withdrawn'
 where lifecycle_status <> 'withdrawn'
   and status = 'withdrawn';

update registrations
   set discipline_status = 'disqualified'
 where discipline_status <> 'disqualified'
   and status = 'disqualified';

-- Indexes mirror 0016 / 0029. Operator filters by event + axis.
create index if not exists registrations_event_lifecycle_idx
  on registrations (event_id, lifecycle_status);

create index if not exists registrations_event_discipline_idx
  on registrations (event_id, discipline_status)
 where discipline_status = 'disqualified';

comment on column registrations.lifecycle_status is
  'active | withdrawn. Athlete pulled out of the event before/after '
  'paying. Manually written by operator endpoints; no triggers.';

comment on column registrations.discipline_status is
  'clear | disqualified. Referee/operator ruling. Independent of '
  'lifecycle (a DQ''d athlete is still "active" — they just cannot '
  'compete).';

comment on column registrations.status is
  'DEPRECATED denormalised mirror of (lifecycle_status, '
  'discipline_status, checkin_status, payment_summary.derived_status). '
  'New code must NOT read or write this column for paid/weighed_in '
  'semantics — use the dedicated columns / payment_summary instead. '
  'Kept only so historical rows and unmigrated analytics keep '
  'rendering until the column is dropped in a future migration.';

-- ════════════════════════════════════════════════════════════════════════════
-- 0040_weight_overrides.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0040_weight_overrides.sql
--
-- Replace the single `weight_bump_up` flag with a per-entry override list
-- that lets the operator pick any heavier WAF bucket (or open) for each
-- (scope, class, hand) on a registration.
--
-- Shape of `weight_overrides` (jsonb array):
--   [
--     { "scope": "nonpara", "code": "M", "hand": "R", "bucket_code": "M-100" },
--     { "scope": "nonpara", "code": "M", "hand": "L", "bucket_code": "M-90"  },
--     { "scope": "para",    "code": "U", "hand": "R", "bucket_code": "U-90+" }
--   ]
--
-- Rules enforced in the resolver, NOT here (so the array can carry stale
-- picks safely after a weight change):
--   * `bucket_code` must be heavier than the auto bucket (ignored if not).
--   * No "competing down" — a lighter override is silently dropped.
--   * Hand must match the resolved hand (B fans into R + L).
--
-- Backfill: every row that had `weight_bump_up = true` gets a synthetic
-- override per (nonpara_classes[i] × hand) marking the bucket "+1". We
-- can't compute the exact bucket from SQL because the WAF grid lives in
-- TypeScript — instead we mark them with a sentinel `bucket_code = "+1"`
-- which the resolver will translate into the next-bucket-up at runtime
-- the first time it sees it. Newer overrides written by the UI carry a
-- real bucket_code and never use the sentinel.

alter table public.registrations
  add column if not exists weight_overrides jsonb not null default '[]'::jsonb;

-- Backfill: turn every weight_bump_up=true row into a sentinel override
-- list across each (class, hand) it currently has. Hand "B" expands to
-- both "R" and "L".
with bumped as (
  select
    r.id,
    r.nonpara_classes,
    r.nonpara_hands
  from public.registrations r
  where r.weight_bump_up = true
    and coalesce(array_length(r.nonpara_classes, 1), 0) > 0
),
expanded as (
  select
    b.id,
    cls.code         as code,
    case when h.hand = 'B' then 'R' else h.hand end as hand
  from bumped b
  cross join lateral unnest(b.nonpara_classes) with ordinality as cls(code, ord)
  cross join lateral (
    select coalesce(b.nonpara_hands[cls.ord], 'R') as hand
  ) h
  union all
  select
    b.id,
    cls.code,
    'L'
  from bumped b
  cross join lateral unnest(b.nonpara_classes) with ordinality as cls(code, ord)
  cross join lateral (
    select coalesce(b.nonpara_hands[cls.ord], 'R') as hand
  ) h
  where h.hand = 'B'
),
agg as (
  select
    id,
    jsonb_agg(jsonb_build_object(
      'scope',       'nonpara',
      'code',        code,
      'hand',        hand,
      'bucket_code', '+1'
    )) as overrides
  from expanded
  group by id
)
update public.registrations r
   set weight_overrides = agg.overrides
  from agg
 where r.id = agg.id
   and r.weight_overrides = '[]'::jsonb;

-- Drop the old flag.
alter table public.registrations
  drop column if exists weight_bump_up;

-- Legacy NOT NULL on weight_class_code is no longer meaningful — final
-- bucket is computed from weight + overrides at fixture time. Leave the
-- column for now (still read by some sheets) but allow nulls so new
-- rows don't have to invent a placeholder code.
alter table public.registrations
  alter column weight_class_code drop not null;

comment on column public.registrations.weight_overrides is
  'Per-entry operator picks: array of {scope,code,hand,bucket_code}. Resolver applies an override only if it points to a HEAVIER bucket than the auto one; lighter picks are ignored.';

-- ════════════════════════════════════════════════════════════════════════════
-- 0041_chest_blocks_start_1000.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0041_chest_blocks_start_1000.sql
-- Shift the chest-number starting base from 100 to 1000.
--
-- Allocation logic from 0026 is otherwise unchanged:
--   * 100-block per (event, group_key) where group_key = district / team / unassigned
--   * chest_no = base + serial, serial = 1..99
--   * a group can own multiple blocks if it overflows
--
-- Only difference: the FIRST block in an event now starts at base 1000
-- (chest_no 1001..1099), the next at 1100, 1200, ... — instead of
-- 100 (chest 101..199), 200, 300, ...

-- Wipe existing chest_blocks first — old rows have base < 1000 and would
-- violate the new check constraint. Backfill block below repopulates them.
delete from chest_blocks;

-- Allow base values from 1000 upwards. Keep the multiple-of-100 rule.
alter table chest_blocks
  drop constraint if exists chest_blocks_base_check;
alter table chest_blocks
  add  constraint chest_blocks_base_check
  check (base >= 1000 and base % 100 = 0);

create or replace function assign_chest_no() returns trigger
language plpgsql as $$
declare
  v_key      text;
  v_base     int;
  v_max      int;
  v_assigned boolean := false;
begin
  if NEW.chest_no is not null or NEW.event_id is null then
    return NEW;
  end if;

  v_key := chest_group_key(NEW.district, NEW.team);

  -- Serialise per-event allocation across concurrent inserts.
  perform pg_advisory_xact_lock(hashtext('chest_no:' || NEW.event_id::text));

  -- Try existing blocks for this group, oldest first.
  for v_base in
    select base from chest_blocks
     where event_id = NEW.event_id and group_key = v_key
     order by base
  loop
    select coalesce(max(chest_no), v_base - 1)
      into v_max
      from registrations
     where event_id = NEW.event_id
       and chest_no between v_base and v_base + 99;
    if v_max < v_base + 99 then
      NEW.chest_no := v_max + 1;
      v_assigned := true;
      exit;
    end if;
  end loop;

  if not v_assigned then
    -- Allocate a fresh 100-block for this group. First block of the
    -- event starts at 1000 (chest 1001); subsequent blocks step by 100.
    select coalesce(max(base), 900) + 100
      into v_base
      from chest_blocks
     where event_id = NEW.event_id;
    if v_base < 1000 then v_base := 1000; end if;
    insert into chest_blocks(event_id, group_key, base)
      values (NEW.event_id, v_key, v_base);
    NEW.chest_no := v_base + 1;
  end if;

  return NEW;
end
$$;

-- ── Backfill: renumber existing registrations under the new base.
-- Mirrors 0026's backfill, only the base floor differs (900 -> 1000).
do $$
declare
  r           record;
  v_key       text;
  v_base      int;
  v_max       int;
  v_assigned  boolean;
begin
  update registrations set chest_no = null where chest_no is not null;

  for r in
    select id, event_id, district, team
      from registrations
     where event_id is not null
     order by event_id, created_at, id
  loop
    v_key      := chest_group_key(r.district, r.team);
    v_assigned := false;

    for v_base in
      select base from chest_blocks
       where event_id = r.event_id and group_key = v_key
       order by base
    loop
      select coalesce(max(chest_no), v_base - 1)
        into v_max
        from registrations
       where event_id = r.event_id
         and chest_no between v_base and v_base + 99;
      if v_max < v_base + 99 then
        update registrations set chest_no = v_max + 1 where id = r.id;
        v_assigned := true;
        exit;
      end if;
    end loop;

    if not v_assigned then
      select coalesce(max(base), 900) + 100
        into v_base
        from chest_blocks
       where event_id = r.event_id;
      if v_base is null or v_base < 1000 then v_base := 1000; end if;
      insert into chest_blocks(event_id, group_key, base)
        values (r.event_id, v_key, v_base);
      update registrations set chest_no = v_base + 1 where id = r.id;
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0042_profile_erased_at.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0042_profile_erased_at.sql
--
-- GDPR/DPDP-style "right to erasure" support.
--
-- Hard-deleting an `auth.users` row cascades through profiles → athletes →
-- registrations → entries → fixtures, which would destroy tournament
-- history. Instead we *anonymize*: PII fields are nulled, the auth user is
-- banned + email tombstoned, and `profiles.erased_at` flags the row so it
-- stays hidden from operator UI but downstream FKs remain valid.
--
-- This migration only adds the column + index. The application layer
-- (web/src/lib/users/erase.ts) is responsible for performing the
-- anonymization steps atomically.

alter table profiles
  add column if not exists erased_at timestamptz;

-- Skip-erased lookups (operator users console, role counts, etc.) get a
-- partial index. Most queries already filter by `disabled_at is null`;
-- erasure also sets disabled_at, so this index serves the
-- "list active operators" path.
create index if not exists profiles_active_idx
  on profiles(role)
  where disabled_at is null and erased_at is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 0043_user_hard_delete.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0043_user_hard_delete.sql
--
-- Switch from anonymization-by-tombstone to true hard-delete of users.
--
-- Plan:
--   * Loosen FKs that reference profiles so deleting a user does not block
--     ("RESTRICT") and does not cascade-destroy tournament history.
--   * Make registrations.athlete_id nullable + SET NULL so a registration
--     row survives after its athlete is deleted (the row keeps its
--     denormalized snapshot columns: full_name, dob, mobile, etc.).
--   * Add profiles.erase_started_at as a stuck-erase marker so the next
--     DELETE call can opportunistically resume any half-finished erasure.
--   * Drop the old profiles.erased_at column + active index introduced by
--     0042 — the anonymization path is gone, so the tombstone marker is
--     no longer needed.
--
-- Display-side contract: anywhere a UI joins one of these FKs and finds
-- NULL, render "Deleted user" / "Deleted athlete". audit_log already
-- snapshots actor_label, so historical log lines stay readable.

begin;

-- 1. registrations.athlete_id: cascade -> set null, allow null
alter table registrations
  drop constraint if exists registrations_athlete_id_fkey;

alter table registrations
  alter column athlete_id drop not null;

alter table registrations
  add constraint registrations_athlete_id_fkey
  foreign key (athlete_id) references athletes(id) on delete set null;

-- 2. events.created_by: implicit restrict -> set null
alter table events
  drop constraint if exists events_created_by_fkey;

alter table events
  add constraint events_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

-- 3. payments.verified_by: implicit restrict -> set null
alter table payments
  drop constraint if exists payments_verified_by_fkey;

alter table payments
  add constraint payments_verified_by_fkey
  foreign key (verified_by) references profiles(id) on delete set null;

-- 4. weigh_ins.weighed_by: implicit restrict -> set null
alter table weigh_ins
  drop constraint if exists weigh_ins_weighed_by_fkey;

alter table weigh_ins
  add constraint weigh_ins_weighed_by_fkey
  foreign key (weighed_by) references profiles(id) on delete set null;

-- 5. payment_collections.collected_by + reversed_by: implicit restrict -> set null
alter table payment_collections
  drop constraint if exists payment_collections_collected_by_fkey;

alter table payment_collections
  add constraint payment_collections_collected_by_fkey
  foreign key (collected_by) references profiles(id) on delete set null;

alter table payment_collections
  drop constraint if exists payment_collections_reversed_by_fkey;

alter table payment_collections
  add constraint payment_collections_reversed_by_fkey
  foreign key (reversed_by) references profiles(id) on delete set null;

-- 6. Erase-in-progress marker. Set at the start of the erase pipeline,
--    cleared implicitly when the profile row is removed by auth-delete
--    cascade. Any profile with this set + still existing is stuck and
--    should be retried.
alter table profiles
  add column if not exists erase_started_at timestamptz;

create index if not exists profiles_erase_started_idx
  on profiles(erase_started_at)
  where erase_started_at is not null;

-- 7. Drop the soft-erasure column from 0042 — no longer used.
drop index if exists profiles_active_idx;

alter table profiles
  drop column if exists erased_at;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 0044_para_entry_fee.sql
-- ════════════════════════════════════════════════════════════════════════════
-- 0044_para_entry_fee.sql
--
-- Per-event Para entry fee override.
--
-- 0036 introduced an `entry_fee_offline_inr` so the counter desk could
-- charge a different (typically discounted) per-hand fee than the online
-- form. Federations also routinely charge a separate, lower fee for Para
-- athletes regardless of channel — and until now operators had to type
-- that discount into the Total field by hand for every Para entry.
--
-- This migration adds `events.entry_fee_para_inr int null`. NULL means
-- "no Para override" so existing events keep their current behaviour.
--
-- Resolution order (per /lib/payments/fee.ts):
--   * online channel              → entry_fee_default_inr
--   * offline + non-Para entry    → entry_fee_offline_inr ?? entry_fee_default_inr
--   * offline + Para entry        → entry_fee_para_inr ?? entry_fee_offline_inr ?? entry_fee_default_inr
--
-- The Para fee deliberately only applies offline because the public
-- registration form has no class selection at submit time — the athlete
-- types one fee and the operator confirms the rest at the desk.

alter table public.events
  add column if not exists entry_fee_para_inr int
    check (entry_fee_para_inr is null or entry_fee_para_inr >= 0);

comment on column public.events.entry_fee_para_inr is
  'Per-hand fee charged for Para entries at the counter desk. NULL means use entry_fee_offline_inr (then entry_fee_default_inr).';


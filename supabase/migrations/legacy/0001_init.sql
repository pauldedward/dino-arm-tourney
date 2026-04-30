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

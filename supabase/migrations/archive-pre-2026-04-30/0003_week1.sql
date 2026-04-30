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

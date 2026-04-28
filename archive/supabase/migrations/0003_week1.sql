-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — schema v3 (Week-1 / TN State Championship)
-- See PLAN-WEEK1.md §3.
-- Builds on 0001_init.sql. No destructive changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 3.1 Roles ──────────────────────────────────────────────────────────────
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

-- ─── 3.2 Events: publish/close, branding, full ID-card content ─────────────
alter table events
  add column if not exists registration_published_at timestamptz,
  add column if not exists registration_closed_at  timestamptz,
  add column if not exists payment_provider        text not null default 'manual_upi'
    check (payment_provider in ('manual_upi','razorpay','none')),
  add column if not exists upi_id                  text,
  add column if not exists upi_payee_name          text,
  add column if not exists entry_fee_default_inr   int default 500,
  add column if not exists fee_overrides           jsonb default '{}'::jsonb,
  -- Branding (R2 URLs)
  add column if not exists logo_url                text,
  add column if not exists banner_url              text,
  add column if not exists primary_color           text default '#0f3d2e',
  add column if not exists accent_color            text default '#f5c518',
  add column if not exists text_on_primary         text default '#ffffff',
  add column if not exists id_card_template        text default 'tnawa_v1',
  -- ID-card content (per-event; no globals)
  add column if not exists id_card_org_name        text,
  add column if not exists id_card_event_title     text,
  add column if not exists id_card_subtitle        text,
  add column if not exists id_card_footer          text,
  add column if not exists id_card_signatory_name  text,
  add column if not exists id_card_signatory_title text,
  add column if not exists id_card_signature_url   text;

-- A registration form is OPEN when:
--   registration_published_at IS NOT NULL
--   AND (registration_closed_at IS NULL OR registration_closed_at > now())

-- ─── 3.3 Para arm wrestling on athletes ────────────────────────────────────
alter table athletes
  add column if not exists is_para        boolean not null default false,
  add column if not exists para_class     text
    check (para_class in ('PD1','PD2','PS1','PS2','PS3','B1','B2','B3')),
  add column if not exists para_posture   text
    check (para_posture in ('Standing','Seated'));

-- ─── 3.4 Registrations: extend with full athlete payload ────────────────────
-- (Athletes don't have Supabase Auth users in week 1 — public registration form
--  inserts a row directly. The athlete_id FK in registrations stays nullable in
--  practice; we relax NOT NULL here.)
alter table registrations
  alter column athlete_id drop not null;

alter table registrations
  add column if not exists chest_no           int,
  add column if not exists initial            text,
  add column if not exists full_name          text,
  add column if not exists dob                date,
  add column if not exists gender             text check (gender in ('M','F','O')),
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
  add column if not exists submitted_by       text default 'self',
  add column if not exists is_para            boolean not null default false,
  add column if not exists para_class         text
    check (para_class in ('PD1','PD2','PS1','PS2','PS3','B1','B2','B3')),
  add column if not exists para_posture       text
    check (para_posture in ('Standing','Seated'));

-- Auto chest_no per event starting at 1001.
create or replace function next_chest_no(p_event uuid) returns int
language plpgsql as $$
declare
  n int;
begin
  select coalesce(max(chest_no), 1000) + 1
    into n
    from registrations
    where event_id = p_event;
  return n;
end$$;

create unique index if not exists registrations_event_chest_no_idx
  on registrations(event_id, chest_no);

-- ─── 3.5 Payments ──────────────────────────────────────────────────────────
create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  amount_inr      int not null,
  method          text not null default 'manual_upi'
    check (method in ('manual_upi','razorpay','cash','waiver')),
  utr             text,
  proof_url       text,                   -- R2 (private, signed URL)
  status          text not null default 'pending'
    check (status in ('pending','submitted','verified','rejected')),
  verified_by     uuid references profiles(id),
  verified_at     timestamptz,
  notes           text,
  created_at      timestamptz default now()
);
create index if not exists payments_registration_idx on payments(registration_id);
create index if not exists payments_status_idx on payments(status);

-- ─── 3.6 Weigh-ins (append-only) ───────────────────────────────────────────
create table if not exists weigh_ins (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  measured_kg     numeric(5,2) not null,
  live_photo_url  text,                   -- R2
  scale_photo_url text,                   -- R2 (optional)
  weighed_by      uuid references profiles(id),
  weighed_at      timestamptz default now()
);
create index if not exists weigh_ins_registration_idx on weigh_ins(registration_id, weighed_at desc);

-- ─── 3.7 Audit log ─────────────────────────────────────────────────────────
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
create index if not exists audit_log_event_idx  on audit_log(event_id, created_at desc);
create index if not exists audit_log_actor_idx  on audit_log(actor_id, created_at desc);
create index if not exists audit_log_action_idx on audit_log(action, created_at desc);

-- ─── 3.8 Entries + fixtures (single-elim this week) ────────────────────────
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
create index if not exists entries_category_idx on entries(category_code);

create table if not exists fixtures (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  category_code   text not null,
  round_no        int not null,
  match_no        int not null,
  entry_a_id      uuid references entries(id),
  entry_b_id      uuid references entries(id),
  next_match_id   uuid references fixtures(id),
  unique (event_id, category_code, round_no, match_no)
);
create index if not exists fixtures_event_idx on fixtures(event_id, category_code);

-- ─── 3.9 RLS ───────────────────────────────────────────────────────────────
alter table payments  enable row level security;
alter table weigh_ins enable row level security;
alter table audit_log enable row level security;
alter table entries   enable row level security;
alter table fixtures  enable row level security;

create or replace function role_at_least(min_role text) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.disabled_at is null
      and case min_role
        when 'operator'    then p.role in ('operator','weigh_in_official','super_admin','federation_admin','organiser')
        when 'super_admin' then p.role = 'super_admin'
        else false
      end
  );
$$;

-- Operators: read everything in scope.
drop policy if exists "payments_operator_read" on payments;
create policy "payments_operator_read" on payments
  for select using (role_at_least('operator'));
drop policy if exists "payments_operator_write" on payments;
create policy "payments_operator_write" on payments
  for all using (role_at_least('operator')) with check (role_at_least('operator'));

drop policy if exists "weigh_ins_operator_read" on weigh_ins;
create policy "weigh_ins_operator_read" on weigh_ins
  for select using (role_at_least('operator'));
drop policy if exists "weigh_ins_operator_insert" on weigh_ins;
create policy "weigh_ins_operator_insert" on weigh_ins
  for insert with check (role_at_least('operator'));

drop policy if exists "entries_operator_all" on entries;
create policy "entries_operator_all" on entries
  for all using (role_at_least('operator')) with check (role_at_least('operator'));

drop policy if exists "fixtures_operator_all" on fixtures;
create policy "fixtures_operator_all" on fixtures
  for all using (role_at_least('operator')) with check (role_at_least('operator'));

-- Audit log: any authenticated user may insert. Only super_admin may read.
drop policy if exists "audit_log_insert_any" on audit_log;
create policy "audit_log_insert_any" on audit_log
  for insert with check (auth.uid() is not null);
drop policy if exists "audit_log_super_read" on audit_log;
create policy "audit_log_super_read" on audit_log
  for select using (role_at_least('super_admin'));

-- Public registration: allow anonymous INSERT into registrations + payments
-- when the event is in published+open state. The route handler uses the
-- service-role key for safety, so these policies are belt-and-braces.
drop policy if exists "registrations_public_insert" on registrations;
create policy "registrations_public_insert" on registrations
  for insert with check (
    exists (
      select 1 from events e
      where e.id = event_id
        and e.registration_published_at is not null
        and (e.registration_closed_at is null or e.registration_closed_at > now())
    )
  );

drop policy if exists "registrations_operator_all" on registrations;
create policy "registrations_operator_all" on registrations
  for all using (role_at_least('operator')) with check (role_at_least('operator'));

-- Allow anonymous payment proof uploads only for registrations they just made.
-- (For week 1, the API route validates ownership via the returned registration id.)
drop policy if exists "payments_public_insert" on payments;
create policy "payments_public_insert" on payments
  for insert with check (true);

-- Events read: public can see only published events. Operators see all.
drop policy if exists "events_public_read" on events;
create policy "events_public_read" on events
  for select using (
    registration_published_at is not null
    or role_at_least('operator')
  );

drop policy if exists "events_super_admin_all" on events;
create policy "events_super_admin_all" on events
  for all using (role_at_least('super_admin')) with check (role_at_least('super_admin'));

-- Profiles: super admins can see all; users see themselves.
drop policy if exists "profiles_super_read" on profiles;
create policy "profiles_super_read" on profiles
  for select using (role_at_least('super_admin'));
drop policy if exists "profiles_super_write" on profiles;
create policy "profiles_super_write" on profiles
  for update using (role_at_least('super_admin')) with check (role_at_least('super_admin'));

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

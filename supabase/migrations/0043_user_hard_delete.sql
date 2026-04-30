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

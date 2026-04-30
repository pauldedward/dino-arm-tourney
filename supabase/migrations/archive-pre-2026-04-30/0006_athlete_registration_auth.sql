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

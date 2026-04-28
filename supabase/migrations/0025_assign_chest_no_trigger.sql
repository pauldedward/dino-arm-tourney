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

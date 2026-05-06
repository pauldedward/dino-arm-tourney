-- 0046_restore_missing_triggers.sql
--
-- The hand-rewritten supabase/schema.sql (2026-04-30 baseline) declared
-- the trigger FUNCTIONS but forgot the matching `create trigger`
-- statements. Three things broke on prod:
--
--   1. registrations.chest_no stays NULL on every new insert
--      (`assign_chest_no` never fires) → no chest numbers anywhere
--      (Nominal/Category/Fixtures/ID-card sheets, registrations table).
--   2. registrations.checkin_status stays 'not_arrived' after a
--      weigh-in (`registrations_mark_weighed_in` never fires) →
--      Category Sheet, Challonge categories page, Nominal sheet,
--      live-categories loader and `loadCategoryParticipants` all
--      filter on `checkin_status='weighed_in'` and silently show 0.
--   3. event_log rows can be UPDATE/DELETE'd without raising
--      (`event_log_immutable` never fires).
--
-- Idempotent: drop-if-exists then create. Also backfills the two
-- broken columns from the source-of-truth tables (weigh_ins +
-- chest_no allocation).
--
-- Apply on prod, then `git mv` into legacy/ and patch schema.sql
-- in the same PR.

------------------------------------------------------------------
-- 1. Triggers
------------------------------------------------------------------

drop trigger if exists registrations_assign_chest_no on registrations;
create trigger registrations_assign_chest_no
  before insert on registrations
  for each row execute function assign_chest_no();

drop trigger if exists weigh_ins_mark_checkin on weigh_ins;
create trigger weigh_ins_mark_checkin
  after insert on weigh_ins
  for each row execute function registrations_mark_weighed_in();

drop trigger if exists event_log_no_update on event_log;
create trigger event_log_no_update
  before update on event_log
  for each row execute function event_log_immutable();

drop trigger if exists event_log_no_delete on event_log;
create trigger event_log_no_delete
  before delete on event_log
  for each row execute function event_log_immutable();

------------------------------------------------------------------
-- 2. Backfill checkin_status from existing weigh_ins
------------------------------------------------------------------

update registrations r
   set checkin_status = 'weighed_in'
 where checkin_status <> 'weighed_in'
   and exists (select 1 from weigh_ins w where w.registration_id = r.id);

------------------------------------------------------------------
-- 3. Backfill chest_no for any registration that's missing one
------------------------------------------------------------------
-- Walks NULL-chest rows per event in created_at order and assigns
-- the next number in the appropriate district/team 100-block, exactly
-- like assign_chest_no would have. Existing chest_no values are NEVER
-- changed (already-printed cards stay valid).
do $$
declare
  r           record;
  v_key       text;
  v_base      int;
  v_max       int;
  v_assigned  boolean;
begin
  for r in
    select id, event_id, district, team
      from registrations
     where event_id is not null
       and chest_no is null
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

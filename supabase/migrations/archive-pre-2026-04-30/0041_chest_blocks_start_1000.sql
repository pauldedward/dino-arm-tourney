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

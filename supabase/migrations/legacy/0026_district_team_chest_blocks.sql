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

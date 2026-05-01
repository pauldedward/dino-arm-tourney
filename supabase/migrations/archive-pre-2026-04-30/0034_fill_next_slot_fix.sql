-- 0034_fill_next_slot_fix.sql
-- Bug: in the losers bracket, the slot at L.r.m has TWO feeders — one
-- "drop" from W.r.m and one "promote" from L.(r-1).m — both with
-- source match_no=1 (in small categories). The parity rule
-- (odd → A, even → B) routed both to side A and the second one to
-- complete its source raised P0001 "side A already filled with different
-- entry". The bracket builder doesn't store an explicit per-feeder side
-- hint.
--
-- Fix: in `fill_next_slot`, when the parity-target side is already
-- filled with a DIFFERENT entry AND the other side is empty, use the
-- other side. There are at most 2 feeders into any slot in single- and
-- double-elimination, so this disambiguates safely without changing the
-- schema or the builder.
create or replace function fill_next_slot(
  p_next_id     uuid,
  p_source_match int,
  p_entry_id    uuid,
  p_actor       uuid,
  p_now         timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next         fixtures%rowtype;
  v_target_side  char;       -- 'A' or 'B'
  v_existing     uuid;
  v_other        uuid;
  v_feeder_count int;
begin
  select * into v_next from fixtures where id = p_next_id for update;
  if not found then return; end if;

  if v_next.status in ('in_progress','completed') then
    raise exception 'downstream fixture % already %', v_next.id, v_next.status
      using errcode = 'P0002';
  end if;

  -- Parity rule first: odd source match → A, even → B.
  v_target_side := case when (p_source_match % 2) = 1 then 'A' else 'B' end;
  if v_target_side = 'A' then
    v_existing := v_next.entry_a_id;
    v_other    := v_next.entry_b_id;
  else
    v_existing := v_next.entry_b_id;
    v_other    := v_next.entry_a_id;
  end if;

  -- If the parity slot is taken by a different entry but the OTHER side
  -- is free, swap to the other side. This handles the LB-drop vs LB-
  -- promote collision where both feeders share match_no=1.
  if v_existing is not null and v_existing <> p_entry_id and v_other is null then
    if v_target_side = 'A' then
      v_target_side := 'B';
    else
      v_target_side := 'A';
    end if;
    v_existing := v_other;  -- now the prior other side is the new target (empty)
    v_other    := case when v_target_side = 'A' then v_next.entry_b_id else v_next.entry_a_id end;
  end if;

  if v_existing is not null and v_existing <> p_entry_id then
    raise exception 'downstream fixture % side % already filled with different entry',
      v_next.id, v_target_side using errcode = 'P0001';
  end if;

  if v_target_side = 'A' then
    update fixtures set entry_a_id = p_entry_id, updated_by = p_actor, updated_at = p_now
      where id = p_next_id;
  else
    update fixtures set entry_b_id = p_entry_id, updated_by = p_actor, updated_at = p_now
      where id = p_next_id;
  end if;

  -- Bye auto-complete: only one feeder ever exists for this slot AND
  -- the other side will never be filled.
  if v_other is null then
    select count(*) into v_feeder_count
      from fixtures src
     where src.event_id      = v_next.event_id
       and src.category_code = v_next.category_code
       and src.status        <> 'completed'
       and src.id            <> p_next_id
       and (
         (src.next_round_no = v_next.round_no
          and src.next_match_no = v_next.match_no
          and coalesce(src.next_bracket_side, src.bracket_side) = v_next.bracket_side)
         or
         (src.loser_next_round_no = v_next.round_no
          and src.loser_next_match_no = v_next.match_no
          and coalesce(src.loser_next_bracket_side, 'L') = v_next.bracket_side)
       );

    if v_feeder_count = 0 then
      update fixtures
         set status          = 'completed',
             winner_entry_id = p_entry_id,
             method          = 'walkover',
             completed_at    = p_now,
             started_at      = coalesce(started_at, p_now),
             updated_by      = p_actor,
             updated_at      = p_now
       where id = p_next_id;
    end if;
  end if;
end;
$$;

revoke execute on function fill_next_slot(uuid, int, uuid, uuid, timestamptz)
  from anon, authenticated, public;

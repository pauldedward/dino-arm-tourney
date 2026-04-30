-- 0035_fill_next_slot_chain.sql
-- Bug: fill_next_slot's auto-walkover branch (other side null AND no
-- remaining feeders) marks the downstream fixture completed but never
-- propagates the walkover winner to ITS own downstream slot. Result:
-- in losers brackets where one feeder is a bye, the chain breaks and
-- a category becomes unfinishable (orphaned winners, downstream
-- matches that look "done" but never actually played).
--
-- Fix: after an auto-walkover, recursively fill the winner-next slot
-- (and loser-next, which for walkovers is always null but we handle
-- it anyway).
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
  v_target_side  char;
  v_existing     uuid;
  v_other        uuid;
  v_feeder_count int;
  v_after        fixtures%rowtype;
begin
  select * into v_next from fixtures where id = p_next_id for update;
  if not found then return; end if;

  if v_next.status in ('in_progress','completed') then
    raise exception 'downstream fixture % already %', v_next.id, v_next.status
      using errcode = 'P0002';
  end if;

  v_target_side := case when (p_source_match % 2) = 1 then 'A' else 'B' end;
  if v_target_side = 'A' then
    v_existing := v_next.entry_a_id;
    v_other    := v_next.entry_b_id;
  else
    v_existing := v_next.entry_b_id;
    v_other    := v_next.entry_a_id;
  end if;

  if v_existing is not null and v_existing <> p_entry_id and v_other is null then
    if v_target_side = 'A' then
      v_target_side := 'B';
    else
      v_target_side := 'A';
    end if;
    v_existing := v_other;
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

  if v_other is null then
    select count(*) into v_feeder_count
      from fixtures src
     where src.event_id      = v_next.event_id
       and src.category_code = v_next.category_code
       and src.status        not in ('completed','void')
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
       where id = p_next_id
       returning * into v_after;

      -- Chain walkover winner forward.
      if v_after.next_round_no is not null then
        perform fill_next_slot(
          (select id from fixtures
            where event_id      = v_after.event_id
              and category_code = v_after.category_code
              and bracket_side  = coalesce(v_after.next_bracket_side, v_after.bracket_side)
              and round_no      = v_after.next_round_no
              and match_no      = v_after.next_match_no
            limit 1),
          v_after.match_no,
          p_entry_id,
          p_actor,
          p_now
        );
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function fill_next_slot(uuid, int, uuid, uuid, timestamptz)
  from anon, authenticated, public;

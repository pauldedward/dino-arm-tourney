-- 0033_fixture_runtime_fix.sql
-- Bug fix for 0030: `apply_fixture_complete` declared OUT columns named
-- `bracket_side`, `round_no`, `match_no`, `status`, `winner_entry_id`
-- which collided with same-named columns on `fixtures` inside the body
-- (Postgres raised `column reference "bracket_side" is ambiguous` the
-- moment we tried to actually use the function during a real match).
--
-- Fix: rename the OUT columns with an `out_` prefix so they cannot
-- shadow real table columns. The function signature (input params) is
-- unchanged, so callers in the app code don't need to change.
drop function if exists apply_fixture_complete(uuid, char, int, int, text, uuid);

create or replace function apply_fixture_complete(
  p_fixture_id uuid,
  p_winner     char,         -- 'A' or 'B'
  p_score_a    int,
  p_score_b    int,
  p_method     text,
  p_actor      uuid
) returns table (
  out_id              uuid,
  out_bracket_side    text,
  out_round_no        int,
  out_match_no        int,
  out_status          text,
  out_winner_entry_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fx              fixtures%rowtype;
  v_winner_entry_id uuid;
  v_loser_entry_id  uuid;
  v_next_id         uuid;
  v_loser_next_id   uuid;
  v_now             timestamptz := now();
begin
  if p_winner not in ('A','B') then
    raise exception 'invalid winner %', p_winner using errcode = '22023';
  end if;

  select * into v_fx from fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'fixture % not found', p_fixture_id using errcode = 'P0003';
  end if;

  if v_fx.status = 'completed' and v_fx.winner_entry_id is not null then
    if (p_winner = 'A' and v_fx.winner_entry_id = v_fx.entry_a_id)
       or (p_winner = 'B' and v_fx.winner_entry_id = v_fx.entry_b_id) then
      return query
        select v_fx.id, v_fx.bracket_side, v_fx.round_no, v_fx.match_no,
               v_fx.status, v_fx.winner_entry_id;
      return;
    else
      raise exception 'fixture % already completed with different winner', p_fixture_id
        using errcode = 'P0001';
    end if;
  end if;

  if p_winner = 'A' then
    v_winner_entry_id := v_fx.entry_a_id;
    v_loser_entry_id  := v_fx.entry_b_id;
  else
    v_winner_entry_id := v_fx.entry_b_id;
    v_loser_entry_id  := v_fx.entry_a_id;
  end if;

  if v_winner_entry_id is null then
    raise exception 'fixture % side % has no entry', p_fixture_id, p_winner
      using errcode = '22023';
  end if;

  update fixtures
     set status          = 'completed',
         winner_entry_id = v_winner_entry_id,
         score_a         = coalesce(p_score_a, score_a),
         score_b         = coalesce(p_score_b, score_b),
         method          = coalesce(p_method, method),
         completed_at    = coalesce(completed_at, v_now),
         started_at      = coalesce(started_at, v_now),
         updated_by      = p_actor,
         updated_at      = v_now
   where id = p_fixture_id;

  -- Resolve winner -> next slot. Qualify all column references with the
  -- table name so they cannot be misread as OUT params from the function
  -- signature.
  if v_fx.next_round_no is not null and v_fx.next_match_no is not null then
    select fixtures.id into v_next_id
      from fixtures
     where fixtures.event_id      = v_fx.event_id
       and fixtures.category_code = v_fx.category_code
       and fixtures.bracket_side  = coalesce(v_fx.next_bracket_side, v_fx.bracket_side)
       and fixtures.round_no      = v_fx.next_round_no
       and fixtures.match_no      = v_fx.next_match_no
     for update;

    if v_next_id is not null then
      perform fill_next_slot(v_next_id, v_fx.match_no, v_winner_entry_id, p_actor, v_now);
    end if;
  end if;

  -- Loser -> drop slot (double-elim only).
  if v_loser_entry_id is not null
     and v_fx.loser_next_round_no is not null
     and v_fx.loser_next_match_no is not null then
    select fixtures.id into v_loser_next_id
      from fixtures
     where fixtures.event_id      = v_fx.event_id
       and fixtures.category_code = v_fx.category_code
       and fixtures.bracket_side  = coalesce(v_fx.loser_next_bracket_side, 'L')
       and fixtures.round_no      = v_fx.loser_next_round_no
       and fixtures.match_no      = v_fx.loser_next_match_no
     for update;

    if v_loser_next_id is not null then
      perform fill_next_slot(v_loser_next_id, v_fx.match_no, v_loser_entry_id, p_actor, v_now);
    end if;
  end if;

  return query
    select f.id, f.bracket_side, f.round_no, f.match_no,
           f.status, f.winner_entry_id
      from fixtures f
     where f.id in (
       select p_fixture_id
       union all select v_next_id where v_next_id is not null
       union all select v_loser_next_id where v_loser_next_id is not null
     );
end;
$$;

revoke execute on function apply_fixture_complete(uuid, char, int, int, text, uuid)
  from anon, authenticated, public;

-- 0030_fixture_runtime.sql
-- Live match-day runtime columns on `fixtures` + atomic auto-advance RPC.
--
-- Until now `fixtures` only stored `winner_entry_id` (set when an operator
-- recorded a result) and the planned routing coordinates from 0022. There
-- was no notion of a match being "in progress" vs "scheduled", no game
-- score for best-of-N grand finals, no method, no started/completed
-- timestamps and no atomic way to commit the result + update the next
-- slot in one transaction. This migration adds those runtime columns and
-- one RPC, `apply_fixture_complete`, that the new operator console calls
-- to close a match and auto-advance both the winner (W next slot) and,
-- in double-elim, the loser (L drop slot).
--
-- Backwards compatible: existing rows pick up `status='scheduled'` (or
-- `'completed'` if `winner_entry_id` was already set), and existing bye
-- fixtures (one entry NULL) are auto-completed in the same transaction
-- so the new operator UI never shows them as actionable.

------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------
-- Some live DBs were rebuilt without the original 0003 winner_entry_id +
-- created_at columns, so include both here as no-ops on schemas that
-- already have them.
alter table fixtures
  add column if not exists winner_entry_id uuid references entries(id) on delete set null,
  add column if not exists created_at      timestamptz not null default now(),
  add column if not exists status          text not null default 'scheduled',
  add column if not exists score_a         smallint not null default 0,
  add column if not exists score_b         smallint not null default 0,
  add column if not exists method          text,
  add column if not exists mat_no          smallint,
  add column if not exists started_at      timestamptz,
  add column if not exists completed_at    timestamptz,
  add column if not exists updated_by      uuid references profiles(id) on delete set null,
  add column if not exists updated_at      timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_status_check'
  ) then
    alter table fixtures
      add constraint fixtures_status_check
      check (status in ('scheduled','in_progress','completed','void'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_method_check'
  ) then
    alter table fixtures
      add constraint fixtures_method_check
      check (method is null or method in
        ('points','pin','disqualification','walkover','forfeit','injury'));
  end if;
end $$;

create index if not exists fixtures_event_status_idx
  on fixtures(event_id, status, mat_no, round_no, match_no);

------------------------------------------------------------------------
-- 2. Backfill — derive status from existing data
------------------------------------------------------------------------
-- Already-recorded winners → completed.
update fixtures
   set status = 'completed',
       completed_at = coalesce(completed_at, created_at)
 where winner_entry_id is not null
   and status = 'scheduled';

-- Bye fixtures (exactly one entry present) auto-complete using the
-- present entry as winner. Walkover method.
update fixtures f
   set winner_entry_id = coalesce(f.entry_a_id, f.entry_b_id),
       status          = 'completed',
       method          = 'walkover',
       completed_at    = coalesce(f.completed_at, f.created_at)
 where f.status = 'scheduled'
   and f.winner_entry_id is null
   and ((f.entry_a_id is null) <> (f.entry_b_id is null));

------------------------------------------------------------------------
-- 3. apply_fixture_complete RPC
--
-- Atomically:
--   * stamps the closing match (status, winner, scores, method, ts, actor)
--   * resolves winner into next_round_no/next_match_no/next_bracket_side slot
--   * resolves loser  into loser_next_*  slot if present
--   * recursively auto-completes any downstream slot that becomes a bye
--     (the other side filled but its match is still scheduled with
--      no opposing entry and no incoming feeder)
--
-- Conflict rules (raised as `raise exception` so PostgREST returns 4xx):
--   * fixture already completed with a different winner → P0001 conflict
--   * a downstream match already in_progress/completed → P0002 lock
------------------------------------------------------------------------
create or replace function apply_fixture_complete(
  p_fixture_id uuid,
  p_winner     char,         -- 'A' or 'B'
  p_score_a    int,
  p_score_b    int,
  p_method     text,
  p_actor      uuid
) returns table (
  affected_id     uuid,
  bracket_side    text,
  round_no        int,
  match_no        int,
  status          text,
  winner_entry_id uuid
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
      -- Idempotent re-submit, same winner. No-op.
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

  -- Resolve winner → next slot.
  if v_fx.next_round_no is not null and v_fx.next_match_no is not null then
    select id into v_next_id
      from fixtures
     where event_id      = v_fx.event_id
       and category_code = v_fx.category_code
       and bracket_side  = coalesce(v_fx.next_bracket_side, v_fx.bracket_side)
       and round_no      = v_fx.next_round_no
       and match_no      = v_fx.next_match_no
     for update;

    if v_next_id is not null then
      perform fill_next_slot(v_next_id, v_fx.match_no, v_winner_entry_id, p_actor, v_now);
    end if;
  end if;

  -- Resolve loser → drop slot (double-elim only).
  if v_loser_entry_id is not null
     and v_fx.loser_next_round_no is not null
     and v_fx.loser_next_match_no is not null then
    select id into v_loser_next_id
      from fixtures
     where event_id      = v_fx.event_id
       and category_code = v_fx.category_code
       and bracket_side  = coalesce(v_fx.loser_next_bracket_side, 'L')
       and round_no      = v_fx.loser_next_round_no
       and match_no      = v_fx.loser_next_match_no
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

------------------------------------------------------------------------
-- fill_next_slot — helper used by apply_fixture_complete.
--
-- Picks side A or B in the downstream fixture based on the parity of
-- the source `match_no` (odd → A, even → B), refusing to overwrite an
-- existing entry on that side. Auto-completes the slot as a walkover
-- if it ends up with one entry and no possibility of a second feeder.
------------------------------------------------------------------------
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

  v_target_side := case when (p_source_match % 2) = 1 then 'A' else 'B' end;
  if v_target_side = 'A' then
    v_existing := v_next.entry_a_id;
    v_other    := v_next.entry_b_id;
  else
    v_existing := v_next.entry_b_id;
    v_other    := v_next.entry_a_id;
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

  -- Bye auto-complete: only one feeder exists for this slot AND the
  -- other side will never be filled (no remaining feeder pointing here).
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

grant execute on function apply_fixture_complete(uuid, char, int, int, text, uuid) to authenticated;
grant execute on function fill_next_slot(uuid, int, uuid, uuid, timestamptz) to authenticated;
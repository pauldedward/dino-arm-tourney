-- 0022 — first-class double-elimination support on fixtures.
--
-- Until this migration, `fixtures` carried only `(round_no, match_no)` and an
-- optional `next_match_id` pointer. That was enough for single-elimination,
-- but the schema's documented default (`events.bracket_format = 'double_elim'`)
-- could not actually be represented: a double-elim draw needs a second
-- (losers') bracket plus a grand final, and each match needs to know where
-- BOTH the winner AND the loser go next.
--
-- This migration is additive and back-compatible with existing rows:
--   * `bracket_side` defaults to 'W' so historical single-elim fixtures keep
--     working without a backfill.
--   * The (event, category, round, match) unique key is replaced with one
--     that also keys on `bracket_side`, so the same (round, match) coords
--     can exist on the W / L / GF sides simultaneously.
--   * `next_*` and `loser_next_*` are nullable — single-elim leaves the
--     loser routing columns null and walks the winner via the implicit
--     `(round_no+1, ceil(match_no/2))` rule.

alter table fixtures
  add column if not exists bracket_side text not null default 'W';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_bracket_side_check'
  ) then
    alter table fixtures
      add constraint fixtures_bracket_side_check
      check (bracket_side in ('W','L','GF'));
  end if;
end $$;

-- Replace the legacy unique constraint with one that includes bracket_side.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'fixtures_event_id_category_code_round_no_match_no_key'
  ) then
    alter table fixtures
      drop constraint fixtures_event_id_category_code_round_no_match_no_key;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fixtures_event_cat_side_round_match_key'
  ) then
    alter table fixtures
      add constraint fixtures_event_cat_side_round_match_key
      unique (event_id, category_code, bracket_side, round_no, match_no);
  end if;
end $$;

-- Explicit routing coordinates. We don't reuse `next_match_id` (a FK pointer)
-- because populating it requires a second insert pass; coordinates can be
-- written in one shot and resolved at match-completion time.
alter table fixtures
  add column if not exists next_round_no int,
  add column if not exists next_match_no int,
  add column if not exists next_bracket_side text,
  add column if not exists loser_next_round_no int,
  add column if not exists loser_next_match_no int,
  add column if not exists loser_next_bracket_side text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_next_bracket_side_check'
  ) then
    alter table fixtures
      add constraint fixtures_next_bracket_side_check
      check (next_bracket_side is null or next_bracket_side in ('W','L','GF'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fixtures_loser_next_bracket_side_check'
  ) then
    alter table fixtures
      add constraint fixtures_loser_next_bracket_side_check
      check (loser_next_bracket_side is null or loser_next_bracket_side in ('W','L','GF'));
  end if;
end $$;

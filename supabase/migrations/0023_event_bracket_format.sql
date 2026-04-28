-- 0023 — bracket_format actually lives on `events`.
--
-- Migration 0002 originally put `bracket_format` on `categories`, but the
-- active app uses category_code strings (e.g. 'M-−80 kg-R') on
-- entries/fixtures and never populates the categories table. The fixtures
-- generator (web/src/app/api/fixtures/generate/route.ts) reads
-- `events.bracket_format` — so we add the column here, default it to
-- 'double_elim' (matching the rule_profiles.bracket_default in 0001), and
-- backfill all existing rows.

alter table events
  add column if not exists bracket_format text not null default 'double_elim';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_bracket_format_check'
  ) then
    alter table events
      add constraint events_bracket_format_check
      check (bracket_format in ('double_elim','single_elim','round_robin'));
  end if;
end $$;

-- Existing rows already get the default via the column add, but be explicit.
update events set bracket_format = 'double_elim' where bracket_format is null;

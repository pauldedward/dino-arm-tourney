-- 0024_fixtures_best_of.sql
-- Add per-fixture `best_of` count so the bracket builder can mark the
-- Grand Final as best-of-three (and leave room for other formats — e.g.
-- WAF rules allow some pro-circuit GFs to be best-of-five). Existing rows
-- default to 1 (single match). The match runner / paper score card decide
-- a winner once a player reaches ceil(best_of / 2) game wins.
alter table fixtures
  add column if not exists best_of smallint not null default 1
    check (best_of in (1, 3, 5));

-- Backfill: mark any pre-existing GF rows as best-of-3 so the new print /
-- PDF rendering shows the correct number of game slots without requiring
-- a fixture regeneration.
update fixtures set best_of = 3 where bracket_side = 'GF' and best_of <> 3;

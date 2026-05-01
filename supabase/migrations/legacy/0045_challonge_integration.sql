-- 0045_challonge_integration.sql
--
-- Per-event Challonge integration. Operators can enable Challonge on a
-- per-event basis and push the categories of that event to Challonge as
-- separate tournaments grouped under a Premier subdomain (e.g.
-- "tn-arm-2026").
--
-- Settings live on the `events` row. We deliberately do NOT cache the list
-- of pushed tournaments locally: Challonge's `GET /tournaments.json?subdomain=X`
-- returns every tournament under a subdomain in a single call, so the
-- categories page derives push state live at request time. This avoids
-- drift when tournaments are deleted or renamed directly on Challonge.

alter table public.events
  add column if not exists challonge_enabled boolean not null default false;

alter table public.events
  add column if not exists challonge_api_key text;

alter table public.events
  add column if not exists challonge_username text;

alter table public.events
  add column if not exists challonge_subdomain text;

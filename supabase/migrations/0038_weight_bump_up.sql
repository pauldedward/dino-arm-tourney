-- 0038_weight_bump_up.sql
--
-- Per-registration opt-in flag that lets a non-para athlete compete one
-- WAF weight bucket above the one their measured/declared weight would
-- normally place them in. Common ask in regional events: a 78-kg senior
-- who wants to enter the −80 kg bucket gets bumped to −85 kg instead.
--
-- Resolver ignores this flag for para entries (sometimes the bracket
-- has only one bucket, sometimes the medical class wouldn't allow it).
-- Bumping past the open bucket is a no-op (you're already at the top).
--
-- The column is non-null with default false so every existing row stays
-- in its current bucket until an operator explicitly flips the toggle.

alter table public.registrations
  add column if not exists weight_bump_up boolean not null default false;

comment on column public.registrations.weight_bump_up is
  'Non-para opt-in: place this athlete one weight bucket above the one their weight resolves to. No-op for para entries and at the open bucket.';

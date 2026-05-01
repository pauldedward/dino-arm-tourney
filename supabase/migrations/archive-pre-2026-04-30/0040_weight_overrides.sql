-- 0040_weight_overrides.sql
--
-- Replace the single `weight_bump_up` flag with a per-entry override list
-- that lets the operator pick any heavier WAF bucket (or open) for each
-- (scope, class, hand) on a registration.
--
-- Shape of `weight_overrides` (jsonb array):
--   [
--     { "scope": "nonpara", "code": "M", "hand": "R", "bucket_code": "M-100" },
--     { "scope": "nonpara", "code": "M", "hand": "L", "bucket_code": "M-90"  },
--     { "scope": "para",    "code": "U", "hand": "R", "bucket_code": "U-90+" }
--   ]
--
-- Rules enforced in the resolver, NOT here (so the array can carry stale
-- picks safely after a weight change):
--   * `bucket_code` must be heavier than the auto bucket (ignored if not).
--   * No "competing down" — a lighter override is silently dropped.
--   * Hand must match the resolved hand (B fans into R + L).
--
-- Backfill: every row that had `weight_bump_up = true` gets a synthetic
-- override per (nonpara_classes[i] × hand) marking the bucket "+1". We
-- can't compute the exact bucket from SQL because the WAF grid lives in
-- TypeScript — instead we mark them with a sentinel `bucket_code = "+1"`
-- which the resolver will translate into the next-bucket-up at runtime
-- the first time it sees it. Newer overrides written by the UI carry a
-- real bucket_code and never use the sentinel.

alter table public.registrations
  add column if not exists weight_overrides jsonb not null default '[]'::jsonb;

-- Backfill: turn every weight_bump_up=true row into a sentinel override
-- list across each (class, hand) it currently has. Hand "B" expands to
-- both "R" and "L".
with bumped as (
  select
    r.id,
    r.nonpara_classes,
    r.nonpara_hands
  from public.registrations r
  where r.weight_bump_up = true
    and coalesce(array_length(r.nonpara_classes, 1), 0) > 0
),
expanded as (
  select
    b.id,
    cls.code         as code,
    case when h.hand = 'B' then 'R' else h.hand end as hand
  from bumped b
  cross join lateral unnest(b.nonpara_classes) with ordinality as cls(code, ord)
  cross join lateral (
    select coalesce(b.nonpara_hands[cls.ord], 'R') as hand
  ) h
  union all
  select
    b.id,
    cls.code,
    'L'
  from bumped b
  cross join lateral unnest(b.nonpara_classes) with ordinality as cls(code, ord)
  cross join lateral (
    select coalesce(b.nonpara_hands[cls.ord], 'R') as hand
  ) h
  where h.hand = 'B'
),
agg as (
  select
    id,
    jsonb_agg(jsonb_build_object(
      'scope',       'nonpara',
      'code',        code,
      'hand',        hand,
      'bucket_code', '+1'
    )) as overrides
  from expanded
  group by id
)
update public.registrations r
   set weight_overrides = agg.overrides
  from agg
 where r.id = agg.id
   and r.weight_overrides = '[]'::jsonb;

-- Drop the old flag.
alter table public.registrations
  drop column if exists weight_bump_up;

-- Legacy NOT NULL on weight_class_code is no longer meaningful — final
-- bucket is computed from weight + overrides at fixture time. Leave the
-- column for now (still read by some sheets) but allow nulls so new
-- rows don't have to invent a placeholder code.
alter table public.registrations
  alter column weight_class_code drop not null;

comment on column public.registrations.weight_overrides is
  'Per-entry operator picks: array of {scope,code,hand,bucket_code}. Resolver applies an override only if it points to a HEAVIER bucket than the auto one; lighter picks are ignored.';

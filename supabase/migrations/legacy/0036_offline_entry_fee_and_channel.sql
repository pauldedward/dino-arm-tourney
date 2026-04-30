-- 0036_offline_entry_fee_and_channel.sql
--
-- Per-channel entry fees + explicit registration channel.
--
-- Until now every event had a single `entry_fee_default_inr` regardless of
-- whether the athlete registered online (public form, UPI proof) or
-- offline (counter desk, cash). Some federations charge a discount for
-- offline cash registrations (or, conversely, a small online surcharge).
--
-- This migration:
--   1. Adds `events.entry_fee_offline_inr int null`. NULL means "same as
--      online" so existing events keep their current behaviour.
--   2. Adds `registrations.channel text` with a CHECK for ('online','offline')
--      so we can record + report on how each athlete entered, and so the
--      counter desk can edit an online registration without flipping the fee.
--   3. Backfills `channel` from the existing `submitted_by` column
--      ('self' → online, anything else → offline).
--
-- Both columns are additive and nullable / defaulted, so the migration is
-- safe to apply without any application changes.

alter table public.events
  add column if not exists entry_fee_offline_inr int
    check (entry_fee_offline_inr is null or entry_fee_offline_inr >= 0);

comment on column public.events.entry_fee_offline_inr is
  'Per-hand fee charged at the counter desk for offline registrations. NULL means use entry_fee_default_inr (the online fee).';

alter table public.registrations
  add column if not exists channel text
    not null default 'offline'
    check (channel in ('online','offline'));

comment on column public.registrations.channel is
  'How the athlete registered: ''online'' (public form) or ''offline'' (counter desk). Drives which event fee column applies and is preserved across edits.';

-- Backfill: existing rows pre-migration had `submitted_by` = ''self'' for
-- public registrations, anything else (''bulk'') for counter-desk entries.
update public.registrations
   set channel = case when submitted_by = 'self' then 'online' else 'offline' end
 where channel = 'offline'  -- only touch defaulted rows
   and submitted_by = 'self';

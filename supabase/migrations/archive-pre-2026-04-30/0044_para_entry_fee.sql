-- 0044_para_entry_fee.sql
--
-- Per-event Para entry fee override.
--
-- 0036 introduced an `entry_fee_offline_inr` so the counter desk could
-- charge a different (typically discounted) per-hand fee than the online
-- form. Federations also routinely charge a separate, lower fee for Para
-- athletes regardless of channel — and until now operators had to type
-- that discount into the Total field by hand for every Para entry.
--
-- This migration adds `events.entry_fee_para_inr int null`. NULL means
-- "no Para override" so existing events keep their current behaviour.
--
-- Resolution order (per /lib/payments/fee.ts):
--   * online channel              → entry_fee_default_inr
--   * offline + non-Para entry    → entry_fee_offline_inr ?? entry_fee_default_inr
--   * offline + Para entry        → entry_fee_para_inr ?? entry_fee_offline_inr ?? entry_fee_default_inr
--
-- The Para fee deliberately only applies offline because the public
-- registration form has no class selection at submit time — the athlete
-- types one fee and the operator confirms the rest at the desk.

alter table public.events
  add column if not exists entry_fee_para_inr int
    check (entry_fee_para_inr is null or entry_fee_para_inr >= 0);

comment on column public.events.entry_fee_para_inr is
  'Per-hand fee charged for Para entries at the counter desk. NULL means use entry_fee_offline_inr (then entry_fee_default_inr).';

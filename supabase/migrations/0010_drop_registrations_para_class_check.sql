-- 0010 — Drop legacy check constraint on registrations.para_class
--
-- Migration 0008 introduced WAF para codes (e.g. 'U', 'S1', 'S2', etc.) on
-- registrations.para_codes (text[]) as the source of truth. The legacy
-- single `para_class` column on registrations still has a check constraint
-- restricting it to the old TNAWA codes ('PD1','PD2','PS1','PS2','PS3',
-- 'B1','B2','B3'), which now conflicts with new submissions that mirror
-- para_codes[0] into para_class for back-compat.
--
-- 0008 dropped the equivalent constraint on `athletes.para_class` but
-- missed the one on `registrations`. This migration finishes the job.

alter table registrations
  drop constraint if exists registrations_para_class_check;

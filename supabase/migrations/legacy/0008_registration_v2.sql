-- 0008 — Registration model v2
-- Decouple gender from participation track. An athlete now records a
-- gender (M/F) plus optional non-para participation (age classes + hand)
-- AND optional para participation (para classes + hand). Either side
-- alone — or both together — is a valid registration as long as at least
-- one (classes, hand) pair is filled.

alter table registrations
  add column if not exists gender          text check (gender in ('M','F')),
  add column if not exists nonpara_classes text[],
  add column if not exists nonpara_hand    text check (nonpara_hand in ('R','L','B')),
  add column if not exists para_codes      text[],
  add column if not exists para_hand       text check (para_hand in ('R','L','B'));

-- Backfill `gender` from the legacy `division` text where possible. The
-- registration row used to encode gender + para into one string.
update registrations
   set gender = case
                  when division ilike '%women%' then 'F'
                  when division in ('Men','Para Men') then 'M'
                  else gender
                end
 where gender is null;

-- Allow legacy non-WAF para_class values to coexist with the new WAF
-- official codes by dropping the restrictive check. The new para_codes
-- array is the source of truth going forward; `athletes.para_class`
-- becomes a free-form display column.
alter table athletes
  drop constraint if exists athletes_para_class_check;

-- The legacy `division` column on registrations stays for back-compat
-- (admin filters, CSV export, etc.) but is now optional. Existing
-- consumers continue to read it; new registrations write a derived value
-- (Men / Women / Para Men / Para Women) computed from gender + para
-- selection.
alter table registrations
  alter column division drop not null;

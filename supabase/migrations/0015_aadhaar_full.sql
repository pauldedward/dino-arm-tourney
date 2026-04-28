-- 0015_aadhaar_full.sql
-- Store the full Aadhaar number alongside the masked form so operator
-- workflows (bulk-register edit, audit, payment verification) can
-- round-trip the value the operator typed. The masked column stays for
-- display in lists / exports.
--
-- PII: Full Aadhaar is sensitive. Existing RLS on athletes/registrations
-- already restricts read to operator+ via the service role; do NOT add
-- an `aadhaar` column to any view that the public/athlete role can read.

alter table athletes
  add column if not exists aadhaar text;

alter table registrations
  add column if not exists aadhaar text;

-- Same shape constraint as the masking helper expects (12 digits).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'athletes_aadhaar_format'
  ) then
    alter table athletes
      add constraint athletes_aadhaar_format
      check (aadhaar is null or aadhaar ~ '^[0-9]{12}$');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'registrations_aadhaar_format'
  ) then
    alter table registrations
      add constraint registrations_aadhaar_format
      check (aadhaar is null or aadhaar ~ '^[0-9]{12}$');
  end if;
end$$;

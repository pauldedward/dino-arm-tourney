-- 0042_profile_erased_at.sql
--
-- GDPR/DPDP-style "right to erasure" support.
--
-- Hard-deleting an `auth.users` row cascades through profiles → athletes →
-- registrations → entries → fixtures, which would destroy tournament
-- history. Instead we *anonymize*: PII fields are nulled, the auth user is
-- banned + email tombstoned, and `profiles.erased_at` flags the row so it
-- stays hidden from operator UI but downstream FKs remain valid.
--
-- This migration only adds the column + index. The application layer
-- (web/src/lib/users/erase.ts) is responsible for performing the
-- anonymization steps atomically.

alter table profiles
  add column if not exists erased_at timestamptz;

-- Skip-erased lookups (operator users console, role counts, etc.) get a
-- partial index. Most queries already filter by `disabled_at is null`;
-- erasure also sets disabled_at, so this index serves the
-- "list active operators" path.
create index if not exists profiles_active_idx
  on profiles(role)
  where disabled_at is null and erased_at is null;

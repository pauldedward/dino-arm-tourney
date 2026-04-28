-- 0020_backfill_offline_payment_method.sql
--
-- Cosmetic backfill: payments inserted before migration 0018 (payment_mode)
-- defaulted to method = 'manual_upi' regardless of how the money actually
-- changed hands. After 0018, the register API and the collect endpoints
-- write 'cash' for offline events, so any pre-0018 row on an event whose
-- payment_mode is now 'offline' is mislabelled and shows up in the
-- operator console with a "UPI" badge instead of "Cash".
--
-- Scope:
--   - only touch payments whose event is now in offline mode,
--   - only flip 'manual_upi' rows (leave 'waiver' alone),
--   - keep status / amount / verified_by / verified_at unchanged.
--
-- Idempotent: running it again is a no-op once the rows are 'cash'.

update payments p
   set method = 'cash'
  from registrations r
  join events e on e.id = r.event_id
 where p.registration_id = r.id
   and e.payment_mode = 'offline'
   and p.method = 'manual_upi';

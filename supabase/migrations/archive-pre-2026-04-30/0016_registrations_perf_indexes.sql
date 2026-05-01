-- 0016_registrations_perf_indexes.sql
-- Speed up the bulk-register "recent saves" sidebar and the operator
-- registrations listing under common filters.
--
-- Why these specific shapes:
--  * recent-bulk endpoint: WHERE event_id = ? AND submitted_by = 'bulk'
--    ORDER BY created_at DESC LIMIT 50.  Without this the query plans
--    a sort on the whole event partition.
--  * payments-by-registration join: payments(registration_id) is the
--    inner side of the join used everywhere; ensure the index is there.
--  * registrations(status) is filtered on the operator console for the
--    weigh-in queue.

create index if not exists registrations_event_submitted_created_idx
  on registrations (event_id, submitted_by, created_at desc);

create index if not exists registrations_event_status_idx
  on registrations (event_id, status);

create index if not exists payments_registration_id_idx
  on payments (registration_id);

-- Ensure deleting an event does not fail because of audit_log FK.
-- Replace the existing FK (which may have been created without ON DELETE SET NULL
-- on some environments) with one that sets event_id to NULL on event deletion.

alter table audit_log
  drop constraint if exists audit_log_event_id_fkey;

alter table audit_log
  add constraint audit_log_event_id_fkey
  foreign key (event_id) references events(id) on delete set null;

-- 0029_registration_checkin_status.sql
--
-- Splits "did the athlete weigh in?" off registrations.status so the
-- lifecycle / discipline / check-in / payment dimensions stop colliding
-- in a single column.
--
-- Why a new column instead of repurposing registrations.status:
--   * Existing readers (filters like .in("status", ["paid","weighed_in"]),
--     RPCs, views) keep working without a coordinated cutover.
--   * The new column has exactly one writer — a trigger on weigh_ins —
--     so checkin_status cannot drift from the authoritative count of
--     weigh_ins rows.
--
-- After this migration, application code prefers checkin_status when
-- asking "did this athlete check in / weigh in?", and registrations.status
-- continues to act as a denormalised mirror only for legacy callsites.

alter table registrations
  add column if not exists checkin_status text not null default 'not_arrived'
    check (checkin_status in ('not_arrived', 'weighed_in', 'no_show'));

-- Backfill from existing data. A row counts as weighed_in if either the
-- legacy mirror says so OR there is at least one weigh_ins row for it.
update registrations r
   set checkin_status = 'weighed_in'
 where checkin_status <> 'weighed_in'
   and (
     r.status = 'weighed_in'
     or exists (select 1 from weigh_ins w where w.registration_id = r.id)
   );

-- Single writer for checkin_status going forward: the weigh-in trigger.
-- Idempotent — running this insert twice never bounces the column.
create or replace function registrations_mark_weighed_in()
returns trigger
language plpgsql
as $$
begin
  update registrations
     set checkin_status = 'weighed_in'
   where id = new.registration_id
     and checkin_status <> 'weighed_in';
  return new;
end;
$$;

drop trigger if exists weigh_ins_mark_checkin on weigh_ins;
create trigger weigh_ins_mark_checkin
  after insert on weigh_ins
  for each row execute function registrations_mark_weighed_in();

create index if not exists registrations_event_checkin_idx
  on registrations (event_id, checkin_status);

comment on column registrations.checkin_status is
  'Has the athlete weighed in? Auto-maintained by the '
  'weigh_ins_mark_checkin trigger. registrations.status is kept as a '
  'legacy mirror for backward compatibility.';

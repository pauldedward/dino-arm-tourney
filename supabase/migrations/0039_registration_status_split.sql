-- 0039_registration_status_split.sql
--
-- Finishes the job that 0029 (checkin_status) started: split the
-- overloaded `registrations.status` column into purpose-built
-- single-axis columns. Each new column has exactly one writer.
--
-- Before:
--   registrations.status ∈ {pending,paid,weighed_in,withdrawn,disqualified}
--   — conflated 4 axes (lifecycle, discipline, payment, check-in)
--   into one column so "weighed_in" beat "withdrawn" beat "paid" beat
--   "pending" purely by write order. A withdrawn athlete who had
--   weighed in could not be represented without losing one of the two
--   facts.
--
-- After this migration the four axes have dedicated homes:
--
--   lifecycle_status   active | withdrawn          (manual op action)
--   discipline_status  clear  | disqualified       (referee action)
--   checkin_status     not_arrived | weighed_in    (trigger on weigh_ins)
--                      | no_show
--   payment            payment_summary.derived_status (view, 0028+)
--
-- registrations.status is KEPT for back-compat — old code paths and any
-- analytics that still join on it keep working. Going forward, app
-- writers must NOT write 'paid' or 'weighed_in' to it; those signals
-- live on the dedicated columns. The check constraint is left untouched
-- so historical rows pass.

alter table registrations
  add column if not exists lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'withdrawn'));

alter table registrations
  add column if not exists discipline_status text not null default 'clear'
    check (discipline_status in ('clear', 'disqualified'));

-- Backfill from the legacy column. A row's lifecycle is "withdrawn"
-- iff the legacy column says so; otherwise active. Discipline is
-- "disqualified" iff the legacy column says so.
update registrations
   set lifecycle_status = 'withdrawn'
 where lifecycle_status <> 'withdrawn'
   and status = 'withdrawn';

update registrations
   set discipline_status = 'disqualified'
 where discipline_status <> 'disqualified'
   and status = 'disqualified';

-- Indexes mirror 0016 / 0029. Operator filters by event + axis.
create index if not exists registrations_event_lifecycle_idx
  on registrations (event_id, lifecycle_status);

create index if not exists registrations_event_discipline_idx
  on registrations (event_id, discipline_status)
 where discipline_status = 'disqualified';

comment on column registrations.lifecycle_status is
  'active | withdrawn. Athlete pulled out of the event before/after '
  'paying. Manually written by operator endpoints; no triggers.';

comment on column registrations.discipline_status is
  'clear | disqualified. Referee/operator ruling. Independent of '
  'lifecycle (a DQ''d athlete is still "active" — they just cannot '
  'compete).';

comment on column registrations.status is
  'DEPRECATED denormalised mirror of (lifecycle_status, '
  'discipline_status, checkin_status, payment_summary.derived_status). '
  'New code must NOT read or write this column for paid/weighed_in '
  'semantics — use the dedicated columns / payment_summary instead. '
  'Kept only so historical rows and unmigrated analytics keep '
  'rendering until the column is dropped in a future migration.';

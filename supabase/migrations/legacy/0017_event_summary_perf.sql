-- 0017_event_summary_perf.sql
-- Collapse the /admin/events/[id] dashboard's 3 parallel COUNT(*) queries
-- (~110ms each) into a single round-trip via a SECURITY DEFINER function.
-- Counts go through registrations because payments has no event_id column.

create or replace function public.event_dashboard_counts(p_event_id uuid)
returns table (
  total_regs bigint,
  pending_pays bigint,
  verified_pays bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select id from registrations where event_id = p_event_id
  )
  select
    (select count(*) from r),
    (select count(*) from payments p where p.registration_id in (select id from r) and p.status = 'pending'),
    (select count(*) from payments p where p.registration_id in (select id from r) and p.status = 'verified');
$$;

revoke all on function public.event_dashboard_counts(uuid) from public;
grant execute on function public.event_dashboard_counts(uuid) to authenticated, service_role;
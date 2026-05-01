-- 0019_event_dashboard_rpc.sql
-- Single-RTT dashboard fetch for /admin/events/[id]. Returns event row +
-- counts + ₹ totals + per-district totals as one JSON payload. Replaces
-- 4 separate queries (event SELECT + counts RPC + totals view + districts
-- view), saving ~3 RTTs per dashboard load.
create or replace function public.event_dashboard(p_id_or_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_counts jsonb;
  v_totals jsonb;
  v_districts jsonb;
begin
  if p_id_or_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_event from events where id = p_id_or_slug::uuid;
  else
    select * into v_event from events where slug = p_id_or_slug;
  end if;
  if not found then return null; end if;

  with r as (select id, district from registrations where event_id = v_event.id)
  select jsonb_build_object(
    'total_regs',    (select count(*) from r),
    'pending_pays',  (select count(*) from payments p where p.registration_id in (select id from r) and p.status = 'pending'),
    'verified_pays', (select count(*) from payments p where p.registration_id in (select id from r) and p.status = 'verified')
  ) into v_counts;

  select jsonb_build_object(
    'collected_inr', coalesce(sum(amount_inr) filter (where status = 'verified'), 0),
    'pending_inr',   coalesce(sum(amount_inr) filter (where status = 'pending'), 0),
    'collected_n',   count(*) filter (where status = 'verified'),
    'pending_n',     count(*) filter (where status = 'pending')
  ) into v_totals
  from payments p
  where p.registration_id in (select id from registrations where event_id = v_event.id);

  select coalesce(jsonb_agg(d order by d->>'athletes_n' desc), '[]'::jsonb) into v_districts
  from (
    select jsonb_build_object(
      'district',      coalesce(r.district, '—'),
      'athletes_n',    count(*),
      'collected_inr', coalesce(sum(p.amount_inr) filter (where p.status = 'verified'), 0),
      'pending_inr',   coalesce(sum(p.amount_inr) filter (where p.status = 'pending'), 0),
      'collected_n',   count(*) filter (where p.status = 'verified'),
      'pending_n',     count(*) filter (where p.status = 'pending')
    ) as d
    from registrations r
    left join lateral (
      select amount_inr, status from payments
       where registration_id = r.id order by created_at desc limit 1
    ) p on true
    where r.event_id = v_event.id
    group by coalesce(r.district, '—')
  ) s;

  return jsonb_build_object(
    'event',     to_jsonb(v_event),
    'counts',    v_counts,
    'totals',    v_totals,
    'districts', v_districts
  );
end;
$$;

revoke all on function public.event_dashboard(text) from public;
grant execute on function public.event_dashboard(text) to authenticated, service_role;

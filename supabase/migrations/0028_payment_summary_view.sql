-- 0028_payment_summary_view.sql
--
-- Single source of truth for installment-aware payment math.
--
-- Before this migration, two surfaces still used the legacy
-- "is the payments row marked verified?" semantics:
--   * event_dashboard RPC (totals + per-district aggregates)
--   * event_payment_totals / event_district_payment_totals views
-- Those under-counted partial collections (₹200 collected of ₹500 still
-- pending was reported as ₹0 paid / ₹500 due) and ignored payer_label.
--
-- We introduce a single view `payment_summary` that mirrors the TS
-- helper `summarisePayment` in web/src/lib/payments/collections.ts.
-- Every reader of payment math (RPCs, views, SSR loaders) now goes
-- through this view so the rules live in exactly one place. The TS
-- helper is kept only because it operates pre-insert (during a
-- transaction, before the row is visible to the view) — its output
-- must match this view for the same inputs. Tests in
-- collections.test.ts pin the TS side; this view's expressions pin
-- the SQL side.

create or replace view payment_summary as
  select p.id                                                     as payment_id,
         p.registration_id,
         r.event_id,
         p.amount_inr                                             as total_inr,
         p.status                                                 as raw_status,
         coalesce(c.collected_inr, 0)::int                        as collected_inr,
         greatest(0, p.amount_inr - coalesce(c.collected_inr, 0))::int
                                                                  as remaining_inr,
         case
           when p.status = 'rejected' then 'rejected'
           when p.amount_inr > 0
                and coalesce(c.collected_inr, 0) >= p.amount_inr
             then 'verified'
           else 'pending'
         end                                                      as derived_status,
         c.latest_payer_label
    from payments p
    join registrations r on r.id = p.registration_id
    left join lateral (
      select
        coalesce(sum(pc.amount_inr) filter (where pc.reversed_at is null), 0)::int
          as collected_inr,
        (select pc2.payer_label
           from payment_collections pc2
          where pc2.payment_id = p.id
            and pc2.reversed_at is null
            and pc2.payer_label is not null
          order by pc2.collected_at desc
          limit 1)
          as latest_payer_label
        from payment_collections pc
       where pc.payment_id = p.id
    ) c on true;

comment on view payment_summary is
  'Per-payment installment-aware snapshot. Single source of truth for '
  '"how much has been collected, how much is left, what is the effective '
  'status". Mirrors web/src/lib/payments/collections.ts#summarisePayment.';

-- Helper view: per-event totals. Re-uses payment_summary so it cannot
-- drift from the RPC.
create or replace view event_payment_totals as
  select event_id,
         coalesce(sum(collected_inr), 0)::int                          as collected_inr,
         coalesce(sum(remaining_inr) filter (where derived_status = 'pending'), 0)::int
                                                                       as pending_inr,
         coalesce(sum(total_inr) filter (where raw_status = 'rejected'), 0)::int
                                                                       as rejected_inr,
         count(*) filter (where derived_status = 'verified')::int      as collected_n,
         count(*) filter (where derived_status = 'pending')::int       as pending_n
    from payment_summary
   group by event_id;

-- Per-event, per-district totals. Mirrors the RPC's district aggregate;
-- one payment per registration is the norm, but if a registration has
-- multiple payments rows we pick the latest by payment_id as before.
create or replace view event_district_payment_totals as
  select r.event_id,
         coalesce(r.district, '—') as district,
         count(*)::int                                                              as athletes_n,
         coalesce(sum(s.collected_inr), 0)::int                                     as collected_inr,
         coalesce(sum(s.remaining_inr) filter (where s.derived_status = 'pending'), 0)::int
                                                                                    as pending_inr,
         count(*) filter (where s.derived_status = 'verified')::int                 as collected_n,
         count(*) filter (where s.derived_status = 'pending')::int                  as pending_n
    from registrations r
    left join lateral (
      select * from payment_summary
       where registration_id = r.id
       order by payment_id desc
       limit 1
    ) s on true
   group by r.event_id, coalesce(r.district, '—');

-- Rewrite the dashboard RPC to read from payment_summary too, so the
-- single-RTT dashboard fetch sees partial collections correctly.
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

  select jsonb_build_object(
    'total_regs',    (select count(*) from registrations where event_id = v_event.id),
    'pending_pays',  (select count(*) from payment_summary
                       where event_id = v_event.id and derived_status = 'pending'),
    'verified_pays', (select count(*) from payment_summary
                       where event_id = v_event.id and derived_status = 'verified')
  ) into v_counts;

  select jsonb_build_object(
    'collected_inr', coalesce(sum(collected_inr), 0),
    'pending_inr',   coalesce(sum(remaining_inr) filter (where derived_status = 'pending'), 0),
    'collected_n',   count(*) filter (where derived_status = 'verified'),
    'pending_n',     count(*) filter (where derived_status = 'pending')
  ) into v_totals
  from payment_summary
  where event_id = v_event.id;

  select coalesce(jsonb_agg(d order by d->>'athletes_n' desc), '[]'::jsonb) into v_districts
  from (
    select jsonb_build_object(
      'district',      coalesce(r.district, '—'),
      'athletes_n',    count(*),
      'collected_inr', coalesce(sum(s.collected_inr), 0),
      'pending_inr',   coalesce(sum(s.remaining_inr) filter (where s.derived_status = 'pending'), 0),
      'collected_n',   count(*) filter (where s.derived_status = 'verified'),
      'pending_n',     count(*) filter (where s.derived_status = 'pending')
    ) as d
    from registrations r
    left join lateral (
      select * from payment_summary
       where registration_id = r.id
       order by payment_id desc
       limit 1
    ) s on true
    where r.event_id = v_event.id
    group by coalesce(r.district, '—')
  ) sub;

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

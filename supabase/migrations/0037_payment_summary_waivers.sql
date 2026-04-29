-- 0037_payment_summary_waivers.sql
--
-- Make payment math waiver-aware.
--
-- Until now `payment_summary.collected_inr` lumped real money
-- (cash / UPI / razorpay) together with waiver "collections", which
-- meant every downstream report — dashboard tiles, district card,
-- the printable Payment Report — could not tell an organiser:
--
--   * how much cash actually came in;
--   * how much was waived (and for how many athletes);
--   * what the effective billable is after waivers (= total − waived).
--
-- This migration splits the existing `collected_inr` into two flavours:
--
--   collected_inr = received_inr + waived_inr     (closes the bill,
--                                                  kept for status math)
--   received_inr  = sum(active collections where method <> 'waiver')
--   waived_inr    = sum(active collections where method  = 'waiver')
--
-- Downstream views + the dashboard RPC are widened with the new
-- columns. The status flip rule (collected >= total → verified)
-- is unchanged — a fully-waived payment is still "verified" from
-- the registration's point of view, just with received_inr = 0.

create or replace view payment_summary as
  select p.id                                                     as payment_id,
         p.registration_id,
         r.event_id,
         p.amount_inr                                             as total_inr,
         p.status                                                 as raw_status,
         coalesce(c.collected_inr, 0)::int                        as collected_inr,
         coalesce(c.received_inr, 0)::int                         as received_inr,
         coalesce(c.waived_inr, 0)::int                           as waived_inr,
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
        coalesce(sum(pc.amount_inr) filter (
          where pc.reversed_at is null and pc.method <> 'waiver'
        ), 0)::int
          as received_inr,
        coalesce(sum(pc.amount_inr) filter (
          where pc.reversed_at is null and pc.method = 'waiver'
        ), 0)::int
          as waived_inr,
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
  'Per-payment installment-aware snapshot, waiver-aware. '
  'collected_inr = received_inr + waived_inr; received is real money, '
  'waived is concession. Status flips to verified when collected >= total '
  '(i.e. either real money or waivers can close the bill). Mirrors '
  'web/src/lib/payments/collections.ts#summarisePayment.';

-- Per-event totals: split received vs waived; expose billable + effective
-- so the operator dashboard can show "₹X received of ₹Y effective
-- (₹Z waived from a ₹T billable)".
create or replace view event_payment_totals as
  select event_id,
         coalesce(sum(collected_inr), 0)::int                          as collected_inr,
         coalesce(sum(received_inr), 0)::int                           as received_inr,
         coalesce(sum(waived_inr), 0)::int                             as waived_inr,
         coalesce(sum(remaining_inr) filter (where derived_status = 'pending'), 0)::int
                                                                       as pending_inr,
         coalesce(sum(total_inr) filter (where raw_status = 'rejected'), 0)::int
                                                                       as rejected_inr,
         coalesce(sum(total_inr) filter (where raw_status <> 'rejected'), 0)::int
                                                                       as billable_inr,
         coalesce(sum(total_inr) filter (where raw_status <> 'rejected'), 0)::int
           - coalesce(sum(waived_inr), 0)::int                         as effective_inr,
         count(*) filter (where derived_status = 'verified')::int      as collected_n,
         count(*) filter (where derived_status = 'pending')::int       as pending_n,
         count(*) filter (where waived_inr > 0)::int                   as waived_n
    from payment_summary
   group by event_id;

-- Per-event, per-district totals. Same one-payment-per-registration
-- rule as before (latest payment_id).
create or replace view event_district_payment_totals as
  select r.event_id,
         coalesce(r.district, '—') as district,
         count(*)::int                                                              as athletes_n,
         coalesce(sum(s.collected_inr), 0)::int                                     as collected_inr,
         coalesce(sum(s.received_inr), 0)::int                                      as received_inr,
         coalesce(sum(s.waived_inr), 0)::int                                        as waived_inr,
         coalesce(sum(s.remaining_inr) filter (where s.derived_status = 'pending'), 0)::int
                                                                                    as pending_inr,
         count(*) filter (where s.derived_status = 'verified')::int                 as collected_n,
         count(*) filter (where s.derived_status = 'pending')::int                  as pending_n,
         count(*) filter (where s.waived_inr > 0)::int                              as waived_n
    from registrations r
    left join lateral (
      select * from payment_summary
       where registration_id = r.id
       order by payment_id desc
       limit 1
    ) s on true
   group by r.event_id, coalesce(r.district, '—');

-- Dashboard RPC: surface the new columns in the JSON payload.
-- `collected_inr` is preserved so any in-flight client cache still
-- renders something sensible while users hard-refresh.
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
    'received_inr',  coalesce(sum(received_inr), 0),
    'waived_inr',    coalesce(sum(waived_inr), 0),
    'pending_inr',   coalesce(sum(remaining_inr) filter (where derived_status = 'pending'), 0),
    'billable_inr',  coalesce(sum(total_inr) filter (where raw_status <> 'rejected'), 0),
    'effective_inr', coalesce(sum(total_inr) filter (where raw_status <> 'rejected'), 0)
                       - coalesce(sum(waived_inr), 0),
    'collected_n',   count(*) filter (where derived_status = 'verified'),
    'pending_n',     count(*) filter (where derived_status = 'pending'),
    'waived_n',      count(*) filter (where waived_inr > 0)
  ) into v_totals
  from payment_summary
  where event_id = v_event.id;

  select coalesce(jsonb_agg(d order by d->>'athletes_n' desc), '[]'::jsonb) into v_districts
  from (
    select jsonb_build_object(
      'district',      coalesce(r.district, '—'),
      'athletes_n',    count(*),
      'collected_inr', coalesce(sum(s.collected_inr), 0),
      'received_inr',  coalesce(sum(s.received_inr), 0),
      'waived_inr',    coalesce(sum(s.waived_inr), 0),
      'pending_inr',   coalesce(sum(s.remaining_inr) filter (where s.derived_status = 'pending'), 0),
      'collected_n',   count(*) filter (where s.derived_status = 'verified'),
      'pending_n',     count(*) filter (where s.derived_status = 'pending'),
      'waived_n',      count(*) filter (where s.waived_inr > 0)
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

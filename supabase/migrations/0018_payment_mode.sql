-- 0018_payment_mode.sql
--
-- Add an explicit `payment_mode` to events so the public registration flow
-- and operator console can branch cleanly between:
--   * online_upi : athletes pay UPI + upload proof (today's default)
--   * offline    : athletes register; operator collects cash/UPI at counter
--                  (or via district incharge in bulk) and ticks them off
--   * hybrid     : both — UPI QR shown but optional, operator can also
--                  collect at the counter
--
-- Inferring the mode from "fee==0 && upi==null" was lossy: turning UPI off
-- also wiped the fee, and the operator console had no payment row to act on
-- for offline athletes (see web/src/app/api/register/route.ts).

alter table events
  add column if not exists payment_mode text not null default 'online_upi'
    check (payment_mode in ('online_upi', 'offline', 'hybrid'));

-- Backfill: existing events with a UPI id keep online_upi; events that were
-- previously the lossy "fee=0, no upi" config become offline so the operator
-- console immediately has rows to collect against.
update events
   set payment_mode =
       case
         when upi_id is not null and coalesce(entry_fee_default_inr, 0) > 0
           then 'online_upi'
         when coalesce(entry_fee_default_inr, 0) > 0
           then 'offline'
         else 'online_upi'
       end
 where payment_mode = 'online_upi';

-- Helper view: per-event payment totals by status. Used by the dashboard
-- "₹ collected / ₹ pending" stats and the by-district summary card.
create or replace view event_payment_totals as
  select r.event_id,
         coalesce(sum(p.amount_inr) filter (where p.status = 'verified'), 0)::int  as collected_inr,
         coalesce(sum(p.amount_inr) filter (where p.status = 'pending'), 0)::int   as pending_inr,
         coalesce(sum(p.amount_inr) filter (where p.status = 'rejected'), 0)::int  as rejected_inr,
         count(*) filter (where p.status = 'verified')::int                        as collected_n,
         count(*) filter (where p.status = 'pending')::int                         as pending_n
    from payments p
    join registrations r on r.id = p.registration_id
   group by r.event_id;

-- Helper view: per-event, per-district totals. Powers the "By district"
-- summary card on the event dashboard.
create or replace view event_district_payment_totals as
  select r.event_id,
         coalesce(r.district, '—') as district,
         count(*)::int                                                              as athletes_n,
         coalesce(sum(p.amount_inr) filter (where p.status = 'verified'), 0)::int   as collected_inr,
         coalesce(sum(p.amount_inr) filter (where p.status = 'pending'), 0)::int    as pending_inr,
         count(*) filter (where p.status = 'verified')::int                         as collected_n,
         count(*) filter (where p.status = 'pending')::int                          as pending_n
    from registrations r
    left join lateral (
      select amount_inr, status
        from payments
       where registration_id = r.id
       order by created_at desc
       limit 1
    ) p on true
   group by r.event_id, coalesce(r.district, '—');

-- Index supports the by-district group-by + bulk-collect lookups.
create index if not exists registrations_event_district_idx
  on registrations (event_id, district);

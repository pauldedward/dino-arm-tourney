-- 0024_payment_installments.sql
--
-- Allow a single `payments` row to be settled in multiple installments
-- (e.g. ₹500 fee → ₹200 cash now, ₹300 UPI later) and to be partially
-- waived ("collect ₹200, waive the rest").
--
-- The existing `payments` table keeps its meaning:
--   - `amount_inr`  = total fee owed for this registration (mutable; can
--                     be adjusted by /api/admin/payments/[id]/adjust-total)
--   - `status`      = denormalised flag, 'verified' iff sum(active
--                     collections) >= amount_inr, otherwise 'pending'
--                     ('rejected' is still settable explicitly).
--
-- The new `payment_collections` table is the source of truth for who
-- collected how much when. Soft-reverse via `reversed_at` so we keep
-- the full audit trail when an operator undoes an accidental verify.

create table if not exists payment_collections (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references payments(id) on delete cascade,
  amount_inr      int  not null check (amount_inr >= 0),
  method          text not null check (method in ('manual_upi','razorpay','cash','waiver')),
  reference       text,
  collected_by    uuid references profiles(id),
  collected_at    timestamptz not null default now(),
  reversed_at     timestamptz,
  reversed_by     uuid references profiles(id),
  reversal_reason text
);

create index if not exists payment_collections_payment_idx
  on payment_collections(payment_id, collected_at desc);

-- Active = not reversed. Used by the API to compute "is this payment
-- fully collected?".
create index if not exists payment_collections_active_idx
  on payment_collections(payment_id)
  where reversed_at is null;

-- Backfill: every payment that is currently `verified` becomes a single
-- collection covering its full amount, attributed to whoever verified it.
-- Pending / rejected payments get nothing — the operator console will
-- start fresh once they begin collecting.
insert into payment_collections
  (payment_id, amount_inr, method, reference, collected_by, collected_at)
select
  p.id,
  p.amount_inr,
  p.method,
  p.notes,
  p.verified_by,
  coalesce(p.verified_at, p.created_at, now())
from payments p
where p.status = 'verified'
  and not exists (
    select 1 from payment_collections pc where pc.payment_id = p.id
  );

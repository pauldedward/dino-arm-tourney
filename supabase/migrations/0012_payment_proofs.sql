-- 0012_payment_proofs.sql
--
-- Allow athletes to submit multiple UTR + screenshot proofs per payment
-- (e.g. the first transfer was rejected, second succeeded). Owner can
-- delete a proof until the payment is verified.
--
-- Backwards compat: payments.utr / payments.proof_url stay in place and
-- are mirrored to the *latest* proof so existing admin UI keeps working.

create table if not exists payment_proofs (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references payments(id) on delete cascade,
  utr         text not null,
  proof_url   text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists payment_proofs_payment_idx
  on payment_proofs(payment_id, created_at desc);

-- Backfill existing single-proof rows so the new UI shows them.
insert into payment_proofs (payment_id, utr, proof_url, created_at)
select id, utr, proof_url, coalesce(created_at, now())
from payments
where utr is not null
  and proof_url is not null
  and not exists (
    select 1 from payment_proofs pp where pp.payment_id = payments.id
  );

-- Distinguish "athlete paid for themselves" from "district / team / sponsor
-- treasurer handed over a pooled amount that covered some athletes". The
-- bulk pool flow stamps every collection it creates with the source label
-- (typically the district / team name) so the audit log + the row UI can
-- show a small "By Trichy DC" chip.

alter table payment_collections
  add column if not exists payer_label text;

create index if not exists payment_collections_payer_label_idx
  on payment_collections (payer_label)
  where payer_label is not null;

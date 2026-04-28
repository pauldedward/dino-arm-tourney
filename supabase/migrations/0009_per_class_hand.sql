-- 0009 — Per-class non-para hand selection.
-- An athlete can now compete in different hands across age categories
-- (e.g. Junior 18 left, Senior right). `nonpara_hands` is a text[] aligned
-- index-for-index with `nonpara_classes`. The legacy single
-- `nonpara_hand` column stays for back-compat (mirrors index 0).

alter table registrations
  add column if not exists nonpara_hands text[];

-- Backfill: existing rows get the same hand for every class they picked.
update registrations
   set nonpara_hands = (
     select array_agg(nonpara_hand) from generate_series(1, coalesce(array_length(nonpara_classes, 1), 0))
   )
 where nonpara_hand is not null
   and nonpara_classes is not null
   and array_length(nonpara_classes, 1) > 0
   and nonpara_hands is null;

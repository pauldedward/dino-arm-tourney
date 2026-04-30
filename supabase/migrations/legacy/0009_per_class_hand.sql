-- 0009 — Per-class non-para hand selection.
-- An athlete can now compete in different hands across age categories
-- (e.g. Junior 18 left, Senior right). `nonpara_hands` is a text[] aligned
-- index-for-index with `nonpara_classes`. The legacy single
-- `nonpara_hand` column stays for back-compat (mirrors index 0).

alter table registrations
  add column if not exists nonpara_hands text[];

-- Backfill: existing rows get the same hand for every class they picked.
-- (`array_fill` repeats the scalar nonpara_hand value into an N-length
-- text[] aligned with nonpara_classes. Earlier draft used a correlated
-- `array_agg` over generate_series, which modern Postgres rejects with
-- "aggregate functions are not allowed in UPDATE".)
update registrations
   set nonpara_hands = array_fill(nonpara_hand, ARRAY[array_length(nonpara_classes, 1)])
 where nonpara_hand is not null
   and nonpara_classes is not null
   and array_length(nonpara_classes, 1) > 0
   and nonpara_hands is null;

-- 0032_category_table_no.sql
-- A category is run on exactly one physical table at the venue. Track that
-- assignment as a simple integer on the category row. (The richer hub /
-- venue_tables model from 0002 is fine but unused for the solo-operator path.)
alter table categories
  add column if not exists table_no smallint
    check (table_no is null or table_no > 0);

create index if not exists categories_event_table_idx
  on categories(event_id, table_no);

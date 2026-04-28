-- 0022_id_card_text_sizes.sql
-- Adds optional override font sizes (in PDF points) for ID-card org name &
-- event title strips so organisers can tune typography per event without
-- touching code. Null means "use the IdCardSheet default" (7.5pt org,
-- 8.5pt title) so existing rows keep their look.
alter table public.events
  add column if not exists id_card_org_name_size    smallint,
  add column if not exists id_card_event_title_size smallint;

-- Sanity bounds — keep sizes in a sensible printable range.
alter table public.events
  drop constraint if exists events_id_card_org_name_size_chk;
alter table public.events
  add constraint events_id_card_org_name_size_chk
    check (id_card_org_name_size is null
        or (id_card_org_name_size between 5 and 14));

alter table public.events
  drop constraint if exists events_id_card_event_title_size_chk;
alter table public.events
  add constraint events_id_card_event_title_size_chk
    check (id_card_event_title_size is null
        or (id_card_event_title_size between 6 and 16));

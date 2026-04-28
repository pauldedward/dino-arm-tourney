-- 0013 — Enable Supabase Realtime on the tables the UI needs to live-update.
-- Keep this list minimal so the websocket payload stays small. If you add
-- a new table that should drive auto-refresh, add it here.
--
-- Why ALTER PUBLICATION: Supabase ships a single logical publication
-- `supabase_realtime` that the realtime server tails. A table only emits
-- change events when it's a member of that publication.

alter publication supabase_realtime add table public.registrations;
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.payment_proofs;
alter publication supabase_realtime add table public.weigh_ins;
alter publication supabase_realtime add table public.events;

-- Fixtures only exist after Week-1 fixture migration. Guard so this file
-- is safe to run on a DB that hasn't created them yet.
do $$
begin
  if exists (select 1 from pg_class where relname = 'fixtures' and relkind = 'r') then
    execute 'alter publication supabase_realtime add table public.fixtures';
  end if;
  if exists (select 1 from pg_class where relname = 'entries' and relkind = 'r') then
    execute 'alter publication supabase_realtime add table public.entries';
  end if;
end$$;

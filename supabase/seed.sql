-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — production seed data (run ONCE on a fresh prod DB)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- What goes here:
--   * The default organisation row(s) the app's "New event" form needs in
--     order to render a non-empty <select>. The app has no UI to create
--     organisations, so without this row no events can be created.
--
-- What does NOT go here (and never will):
--   * Users / profiles  → first super_admin via the /register-super-admin
--                         UI; rest invited from /admin/users.
--   * Events            → created in-app at /admin/events/new.
--   * Registrations / payments / fixtures → real match-day data only.
--   * Rule profiles     → seeded by 0001_init.sql, already in schema.sql.
--   * Districts         → TypeScript constant TN_DISTRICTS, ships with the
--                         Vercel build.
--   * Chest-no blocks   → trigger-allocated on first registration.
--
-- Apply order on a fresh prod project:
--   1. Paste supabase/schema.sql        → Run   (structure + WAF/PAFI rules)
--   2. Paste supabase/seed.sql          → Run   (this file — default org)
--   3. Open <prod>/register-super-admin → Set the owner password
--   4. Log in → /admin/events/new → first event picks the seeded org.
--
-- Idempotent: re-running this file is a no-op (ON CONFLICT DO NOTHING on
-- the unique slug).

insert into organizations (slug, name, kind, country, region)
values (
  'ttnawa',
  'The Tamil Nadu Arm Wrestling Association',
  'federation',
  'IN',
  'Tamil Nadu'
)
on conflict (slug) do nothing;

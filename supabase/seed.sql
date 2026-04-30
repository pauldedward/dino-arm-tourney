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
--   * Rule profiles     → seeded below (PAFI-2024 + WAF-2022 reference rows).
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

-- ── default organisation ────────────────────────────────────────────────────
insert into organizations (slug, name, kind, country, region)
values (
  'ttnawa',
  'The Tamil Nadu Arm Wrestling Association',
  'federation',
  'IN',
  'Tamil Nadu'
)
on conflict (slug) do nothing;

-- ── reference rule profiles ─────────────────────────────────────────────────
-- Used by /admin/events/new — the rule-profile <select> reads from here.
insert into rule_profiles (code, name, bracket_default, protest_fee_inr, warnings_per_foul, fouls_to_lose, weight_classes)
values
  (
    'PAFI-2024',
    'People''s Arm Wrestling Federation India 2024',
    'double_elim', 500, 2, 2,
    '[
      {"code":"IM60",  "label":"Men <60 kg",   "division":"senior_men",  "upper_kg":60},
      {"code":"IM70",  "label":"Men 60-70 kg", "division":"senior_men",  "upper_kg":70},
      {"code":"IM80",  "label":"Men 70-80 kg", "division":"senior_men",  "upper_kg":80},
      {"code":"IM90",  "label":"Men 80-90 kg", "division":"senior_men",  "upper_kg":90},
      {"code":"IM100", "label":"Men 90-100 kg","division":"senior_men",  "upper_kg":100},
      {"code":"IM100P","label":"Men >100 kg",  "division":"senior_men",  "upper_kg":null},
      {"code":"IW55",  "label":"Women <55 kg", "division":"senior_women","upper_kg":55},
      {"code":"IW65",  "label":"Women 55-65 kg","division":"senior_women","upper_kg":65},
      {"code":"IW65P", "label":"Women >65 kg", "division":"senior_women","upper_kg":null}
    ]'::jsonb
  ),
  (
    'WAF-2022',
    'WAF World Championship 2022',
    'double_elim', 500, 2, 2,
    '[
      {"code":"M55",  "label":"Men 55 kg",  "division":"senior_men",  "upper_kg":55},
      {"code":"M60",  "label":"Men 60 kg",  "division":"senior_men",  "upper_kg":60},
      {"code":"M65",  "label":"Men 65 kg",  "division":"senior_men",  "upper_kg":65},
      {"code":"M70",  "label":"Men 70 kg",  "division":"senior_men",  "upper_kg":70},
      {"code":"M75",  "label":"Men 75 kg",  "division":"senior_men",  "upper_kg":75},
      {"code":"M80",  "label":"Men 80 kg",  "division":"senior_men",  "upper_kg":80},
      {"code":"M85",  "label":"Men 85 kg",  "division":"senior_men",  "upper_kg":85},
      {"code":"M90",  "label":"Men 90 kg",  "division":"senior_men",  "upper_kg":90},
      {"code":"M100", "label":"Men 100 kg", "division":"senior_men",  "upper_kg":100},
      {"code":"M110", "label":"Men 110 kg", "division":"senior_men",  "upper_kg":110},
      {"code":"M110P","label":"Men +110 kg","division":"senior_men",  "upper_kg":null},
      {"code":"W50",  "label":"Women 50 kg","division":"senior_women","upper_kg":50},
      {"code":"W55",  "label":"Women 55 kg","division":"senior_women","upper_kg":55},
      {"code":"W60",  "label":"Women 60 kg","division":"senior_women","upper_kg":60},
      {"code":"W65",  "label":"Women 65 kg","division":"senior_women","upper_kg":65},
      {"code":"W70",  "label":"Women 70 kg","division":"senior_women","upper_kg":70},
      {"code":"W80",  "label":"Women 80 kg","division":"senior_women","upper_kg":80},
      {"code":"W90",  "label":"Women 90 kg","division":"senior_women","upper_kg":90},
      {"code":"W90P", "label":"Women +90 kg","division":"senior_women","upper_kg":null}
    ]'::jsonb
  )
on conflict (code) do nothing;

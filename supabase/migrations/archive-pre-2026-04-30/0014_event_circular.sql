-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — 0014: event circular (PDF flyer for download)
--
-- Some federations distribute a printable "circular" — a multi-page PDF with
-- the entire fee schedule, concessions, age categories, contact numbers, etc.
-- It's downloaded by athletes, separate from the marketing poster.
--
-- Stored in the public R2 bucket; we only keep the URL on the event row.
-- ─────────────────────────────────────────────────────────────────────────────

alter table events
  add column if not exists circular_url text;

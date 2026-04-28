-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — 0004: event poster (image or PDF)
--
-- Per-event flyer shown on the public event page and above the registration
-- form. Stored on R2 public bucket, URL on events.poster_url. Kind lets the
-- UI pick between <img> and a PDF embed/link.
-- ─────────────────────────────────────────────────────────────────────────────

alter table events
  add column if not exists poster_url  text,
  add column if not exists poster_kind text
    check (poster_kind in ('image','pdf'));

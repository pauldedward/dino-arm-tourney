<!--
Read PLAN-DEPLOY.md §4 ("Rollout workflow") before merging.
Production auto-deploys when this PR lands on `main`. Treat the preview
URL as the smoke-test surface; do not merge red.
-->

## What changed

<!-- 1–3 sentences. Link to PLAN-WEEK1.md / PLAN-DEPLOY.md sections if relevant. -->

## How to verify

<!-- Step-by-step on the Vercel preview URL. Include the user role(s) needed. -->

## Pre-merge checklist

- [ ] CI is green (typecheck + tests + build).
- [ ] Smoke-tested on the **Vercel preview URL** (not just `localhost`).
- [ ] No new secrets / env vars required, **or** they have been added to Vercel (Production + Preview + Development).

### If this PR adds a `supabase/migrations/*.sql`

Folder location = state (see [supabase/migrations/README.md](../supabase/migrations/README.md)).

- [ ] Migration is **additive + idempotent** (`if not exists`, `if exists`).
- [ ] No column / table / function the previous deploy still reads is dropped in this PR (two-phase rollout — see `PLAN-DEPLOY.md` §4).
- [ ] Migration was applied to **`dino-prod`** (SQL Editor or `node scripts/apply-migrations.mjs --target prod --file <NNNN>_x.sql --apply`) **before** merging this PR.
- [ ] File has been moved into `supabase/migrations/legacy/` in this PR (`git mv`).
- [ ] `npm run schema:bundle` re-run and the refreshed `supabase/schema.sql` is committed.
- [ ] `supabase/migrations/` (root, excluding `legacy/`) is empty — no leftover pending files.

### If a match-day freeze is active

- [ ] Owner has explicitly approved this merge during the freeze window. Otherwise, hold until T+1.

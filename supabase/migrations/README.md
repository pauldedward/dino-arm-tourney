# Supabase migrations

Two-bucket layout — **folder location is the state**.

```
supabase/migrations/
├── legacy/                       ← already applied to dino-prod AND folded into ../schema.sql
├── archive-pre-2026-04-30/       ← old per-PR migrations, superseded by the 2026-04-30 baseline.
│                                   For history only — DO NOT re-run on any DB.
├── README.md                     ← (this file)
└── 0046_*.sql                    ← PENDING: not yet applied to dino-prod
```

> **2026-04-30 baseline rebuild.** Prod schema had drifted from the
> `legacy/*.sql` bundle (commit `a544cab` accidentally stripped lines from
> `0003_week1.sql`). The fix was to **introspect dev (`hmvnelyzqqdfidjalsha`) via
> Supabase MCP and rewrite `../schema.sql` directly from that snapshot.** All
> historical migration files (0001…0044) were moved to
> `archive-pre-2026-04-30/` so future operators don't try to replay them on top
> of the new baseline. `legacy/` is now empty and is the place where future
> applied migrations land (per the workflow below).
>
> As a consequence, `../schema.sql` is **no longer auto-generated** by
> `npm run schema:bundle` — it is hand-curated. The bundler script
> (`web/scripts/build-schema-bundle.mjs`) is now a deprecation stub and refuses
> to run.

## What goes where

| Folder | Meaning | Run on fresh prod? |
|---|---|---|
| `legacy/` | Applied-to-prod migrations from 2026-04-30 onward. Each one is also folded into `../schema.sql` by hand when it lands. | **No** — `schema.sql` already contains everything in `legacy/`. |
| `archive-pre-2026-04-30/` | Historical 0001–0044 files. Superseded by the hand-curated `schema.sql` baseline. | **Never** — for forensic reading only. |
| `migrations/` (root, excluding `legacy/` and `archive-pre-2026-04-30/`) | **Pending work.** Each file is a forward-only change waiting to be applied to prod. | Yes — apply each in numeric order **after** `schema.sql` + `seed.sql`. |

## A new prod DB always = `schema.sql` + `seed.sql` + every pending migration

That's the contract. `schema.sql` is the hand-curated source of truth for a
fresh database. Apply order on a brand-new Postgres / Supabase project:

1. Reset the `public` schema (header of `schema.sql` shows the exact DDL).
2. Run `supabase/schema.sql`.
3. Run `supabase/seed.sql` (rule profiles + any other seed reference rows).
4. Run every file currently in `supabase/migrations/` (root level only) in
   numeric order.

## Workflow for a new migration (`0046_*.sql` and beyond)

1. **Author** the file at `supabase/migrations/0046_<topic>.sql`.
   - Additive + idempotent: `create … if not exists`, `add column if not exists`,
     no destructive `drop column …` of anything the previous deploy still reads.
   - Two-phase for breaking changes (PR A adds new shape + dual-write; PR B backfills
     and drops old shape in a later deploy).
2. **Apply to dev** while iterating: `npm run dev` will fail loudly until the dev DB
   has it. Apply via Supabase SQL Editor (dev project) or `supabase db push`.
3. **Apply to prod** *before* merging the PR:
   - SQL Editor on `dino-prod`, **or**
   - `node scripts/apply-migrations.mjs --target prod --file 0046_x.sql --apply`
     (needs `SUPABASE_DB_URL` env pointing at prod).
4. **In the same PR, `git mv` the file into `legacy/`**:
   ```powershell
   git mv supabase/migrations/0046_<topic>.sql supabase/migrations/legacy/0046_<topic>.sql
   ```
5. **Hand-fold the change into `../schema.sql`** so a fresh DB still reproduces
   the new shape (the bundler is deprecated — edit `schema.sql` directly). If
   the migration also seeds reference data, mirror that into `../seed.sql`.
6. Commit + push + open PR. CI must be green.
7. Merge to `main`. Vercel auto-deploys.

If you ship a PR where the migration is still in the root folder (not yet moved to
`legacy/`), it means the apply-to-prod step hasn't happened yet — **do not merge.**

## How to spot what still needs applying

Anything in `supabase/migrations/` that is **not** under `legacy/` or
`archive-pre-2026-04-30/` is pending. A clean repo at any point in time has
zero pending files.

```powershell
Get-ChildItem supabase/migrations -File   # files here = not yet applied
```

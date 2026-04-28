# Dino Arm Tourney

> End-to-end tournament management for arm wrestling. WAF-rulebook compliant. India-first.

📖 **Read [PLAN.md](PLAN.md) first** — it is the source of truth for product, stack, milestones, and persona map.
🔬 Research citations in [research/00-synthesis-input.md](research/00-synthesis-input.md).

## Repo layout

```
PLAN.md                 ← master plan
research/               ← Valyu-sourced research artefacts (json + md)
supabase/migrations/    ← versioned SQL
web/                    ← Next.js 15 + Tailwind + Supabase app (M0 first draft)
caveman/                ← skill (manually added)
code-reviewer/          ← skill
frontend-design/        ← skill (used for the landing-page aesthetic)
tdd/                    ← skill
valyu-best-practices/   ← skill (used for research)
```

## Quick start (M0)

```bash
# 1. Supabase
#    Create a project at https://supabase.com (free tier OK).
#    In SQL editor, run migrations IN ORDER:
#      supabase/migrations/0001_init.sql
#      supabase/migrations/0002_hubs_eventlog.sql
#      supabase/migrations/0003_week1.sql

# 2. Cloudflare R2 (free 10 GB, zero egress)
#    Create two buckets: dino-arm-tourney-public and dino-arm-tourney-media.
#    Generate an R2 API token with Object Read & Write on both.
#    Enable a public r2.dev URL on the public bucket.

# 3. Web app
cd web
cp .env.example .env.local
#    Fill all SUPABASE_* and R2_* values.

npm install
npm run seed:sample   # loads JSON fixtures into Supabase (idempotent)
npm run dev           # http://localhost:3000
```

Sample super-admin login (from seeder): `superadmin@dino.local` / `Dino@2026!`

To wipe sample data: `npm run seed:reset`.

Then visit:

- `/` — marketing landing (read-only, no DB needed)
- `/app/events/new` — create your first event
- `/e/<slug>` — public event page

## Milestones

- **M0 (this commit)** — landing, schema v1, event CRUD, public event page.
- **M1** — registration + Razorpay + weigh-in + bracket generator.
- **M2** — live referee tablet, Supabase Realtime, Mux VAR, protests.
- **M3** — payouts + TDS/GST + archive + federation portal.
- **M4** — i18n (Tamil/Hindi), native wrappers, NADA, insurance.
# DEPLOY GUIDE — Step by Step

> **Audience: a non-technical operator.** No prior cloud experience needed.
> Time: ~60–90 minutes the first time, then ~2 minutes per future change.
> Cost: **₹0/month** if you stay under the free tiers documented in
> [PLAN-DEPLOY.md](PLAN-DEPLOY.md) §6.
>
> This guide creates a **separate Production environment** so the live
> system and the developer's laptop can never touch each other's data.
>
> Companion to [PLAN-DEPLOY.md](PLAN-DEPLOY.md) (the high-level plan).
> If something here contradicts that doc, that doc wins.

## What you will end up with

```
DEVELOPER LAPTOP            PRODUCTION (the public site)
────────────────            ────────────────────────────
localhost:3000              https://<your-name>.vercel.app
   │                            │
   ├── Supabase project         ├── Supabase project
   │   "dino-dev"               │   "dino-prod"      ← brand new, empty
   │                            │
   ├── R2 buckets               ├── R2 buckets
   │   tournament-manager       │   tm-prod-public   ← brand new, empty
   │   tournament-manager-media │   tm-prod-private  ← brand new, empty
```

The two columns share **nothing**. You can wipe the dev database every
day and production is unaffected. You can stress-test production and
the developer's local app keeps working.

---

## Part A — One-time setup (do this once, ever)

You need 4 free accounts. Use the **same email address** for all of
them so you don't lose access:

- GitHub — https://github.com (the code lives here)
- Vercel — https://vercel.com (runs the website)
- Supabase — https://supabase.com (the database + login system)
- Cloudflare — https://cloudflare.com (stores photos and PDFs)

Sign up with "Continue with GitHub" on Vercel and Supabase so logins
are linked. Pick the **Free / Hobby / Personal** plan on every signup
screen. **Do not enter a credit card** anywhere.

---

## Part B — Create the Production database (Supabase)

### B1. Create the project

1. Open https://supabase.com → **New project**.
2. Name: `dino-prod`. Region: **Mumbai (ap-south-1)** (closest to India).
3. Database password: click **Generate**, then **Copy** it.
   - Open Notepad → paste it → save the file as `prod-secrets.txt` on
     your Desktop. You will fill in more secrets here as you go.
   - **Never email this file. Never commit it to GitHub.**
4. Click **Create new project** and wait ~2 minutes for the green tick.

### B2. Copy the connection details

In the new project sidebar:

1. **Settings → API**.
2. Copy the **Project URL** (looks like `https://abcdefg.supabase.co`)
   into `prod-secrets.txt` next to a label `NEXT_PUBLIC_SUPABASE_URL =`.
3. Copy the **anon public** key into `prod-secrets.txt` next to
   `NEXT_PUBLIC_SUPABASE_ANON_KEY =`.
4. Click **Reveal** on the **service_role** key, copy it into
   `prod-secrets.txt` next to `SUPABASE_SERVICE_ROLE_KEY =`.
   - This key has god-mode. Treat it like a password.

### B3. Apply the schema + seed data (two pastes)

The app needs ~50 tables, indexes, RLS policies, helper functions, and
two small bits of seed data (the default organisation + the WAF/PAFI
rule profiles). They live as 46 numbered files under
`supabase/migrations/`, but for a brand-new project you only need two
bundled files:

- [supabase/schema.sql](supabase/schema.sql) (~160 KB, auto-generated)
  — every table + index + RLS policy + helper function + the two
  `rule_profiles` rows.
- [supabase/seed.sql](supabase/seed.sql) (~30 lines, tiny) — the default
  `organizations` row (`tnawa`). The app has no UI to create orgs, so
  the New-Event form would be unusable without this.

Both files are idempotent (safe to re-paste).

1. In Supabase: sidebar **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` in Notepad → **Select All → Copy** →
   paste → **Run**. Takes ~10 seconds. Expect **"Success. No rows returned."**
3. **New query** again. Open `supabase/seed.sql` → paste → **Run**.
4. Sanity-check via sidebar **Database → Tables**:
   - `rule_profiles` → **2 rows** (`WAF-2022` + `PAFI-2024`)
   - `organizations` → **1 row** (`tnawa` — Tamil Nadu Arm Wrestling Association)
   - `events`, `registrations`, `payments`, `fixtures`, `profiles` → **0 rows** each (this is correct — no real data should exist yet)

When the developer adds a new migration later, they regenerate the
bundle (`npm run schema:bundle`) and commit the refreshed `schema.sql`.
For an **already-live** prod DB, new migrations are applied one file at
a time (see Part E2) — you only paste `schema.sql` once, on day one.

#### B3-alt: one-shot via Supabase CLI (developer's machine)

Skip the copy-paste if the developer prefers automation:

```powershell
npm install -g supabase
supabase login
supabase link --project-ref <dino-prod-ref>   # ref is in the project URL
Get-Content supabase\schema.sql | supabase db push --include-all -
Get-Content supabase\seed.sql   | supabase db push --include-all -
```

Same end result.

### B4. Create the first super-admin (in the browser, after Part D)

The app already ships a one-time bootstrap page —
**`/register-super-admin`** — that creates the first super-admin
account and then disables itself once any super-admin exists.

You'll do this **after** Vercel is deployed (Part D) so the page is
reachable on a real URL. The full step is in **D8**. Specifics for
reference:

- URL: `https://<your-project>.vercel.app/register-super-admin`
- Email is **hard-coded to the project owner** (`edward2000ed@gmail.com`).
  Any other email is rejected with HTTP 403.
- Password rule: **at least 10 characters**. Pick something strong (a
  password manager's generator is fine).
- After submit, you're auto-signed-in and redirected to `/admin`.
- The page becomes "disabled" once it has run successfully — if you
  ever need to **reset the password**, the same page accepts a re-run
  *only* for the owner email (idempotent for password recovery).

No CLI script is needed. Skip ahead to Part C.

### B4. Allow the production website to log users in

1. **Authentication → URL Configuration**.
2. **Site URL**: leave blank for now — you'll fill it in after Part D.
3. Click **Save**. (Come back here at step D6.)

---

## Part C — Create the Production photo storage (Cloudflare R2)

### C1. Create the buckets

1. https://dash.cloudflare.com → left sidebar **R2 Object Storage**.
2. If asked, agree to the free plan (no card needed for the 10 GB tier).
3. Click **Create bucket**. Name: `tm-prod-public`. Location: **Asia-Pacific**. Click **Create**.
4. Click **Create bucket** again. Name: `tm-prod-private`. Location: **Asia-Pacific**. Click **Create**.

### C2. Make the public bucket public

1. Click into `tm-prod-public` → **Settings** tab.
2. Under **Public access**, click **Allow Access** → confirm.
3. Copy the **Public R2.dev Bucket URL** (looks like
   `https://pub-xxxxxxxx.r2.dev`) into `prod-secrets.txt` next to
   `R2_PUBLIC_BASE_URL =`.

### C3. Add CORS to the public bucket (so browsers can load images)

Still on `tm-prod-public` → **Settings** → scroll to **CORS Policy** →
**Add CORS policy**. Paste this exact JSON (you'll fix the URL in Part D):

```json
[
  {
    "AllowedOrigins": ["https://PLACEHOLDER.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

Save. (You will return at step D6 to replace `PLACEHOLDER`.)

### C4. Create an API token with access to both buckets

1. R2 sidebar → **Manage R2 API Tokens** → **Create API token**.
2. Token name: `dino-prod`.
3. Permissions: **Object Read & Write**.
4. Specify buckets: tick **only** `tm-prod-public` and `tm-prod-private`.
5. TTL: **Forever**. Click **Create API Token**.
6. The next page shows secrets **once**. Copy into `prod-secrets.txt`:
   - **Access Key ID** → `R2_ACCESS_KEY_ID =`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY =`
   - **Account ID** (top of the R2 dashboard) → `R2_ACCOUNT_ID =`

Also add:
- `R2_PUBLIC_BUCKET = tm-prod-public`
- `R2_PRIVATE_BUCKET = tm-prod-private`

Your `prod-secrets.txt` should now contain ~10 lines.

---

## Part D — Deploy the website (Vercel)

### D1. Make sure the code is on GitHub

The developer pushes the code to a GitHub repository (e.g.
`your-org/dino-arm-tourney`). Confirm you can see it at
`https://github.com/<your-org>/dino-arm-tourney`. If not, ask the
developer to give you **Read** access.

### D2. Import into Vercel

1. https://vercel.com/new → **Import** next to the repo name.
2. **Configure Project** screen:
   - **Project Name**: `dino-arm-tourney` (this becomes the URL).
   - **Framework Preset**: Next.js (auto-filled).
   - **Root Directory**: click **Edit** → choose **`web`** → **Continue**.
     (Critical — the app lives in `web/`, not the repo root.)
   - **Build & Output Settings**: leave defaults.

### D3. Paste the environment variables

Still on the Configure screen, expand **Environment Variables**. For
**every line** in `prod-secrets.txt`, click **Add another**:

- **Key**: the name on the left of `=`.
- **Value**: the part on the right.
- **Environments**: tick all three (Production, Preview, Development).

Also add these (not in `prod-secrets.txt` because they're not secrets):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | leave blank for now (fix in D6) |
| `NEXT_PUBLIC_APP_ENV` | `production` |
| `NEXT_PUBLIC_ENABLE_SW` | `1` |

### D4. Deploy

Click **Deploy**. First build takes ~3 minutes. When it shows the
confetti screen, click **Continue to Dashboard**.

### D5. Note the URL

On the project dashboard, your URL is shown at the top (e.g.
`https://dino-arm-tourney.vercel.app`). Copy it.

### D6. Fix the three placeholders

Now go back and replace the `PLACEHOLDER` you left in earlier steps:

1. **Vercel** → Project → **Settings → Environment Variables** →
   `NEXT_PUBLIC_APP_URL` → **Edit** → paste your URL → **Save**.
2. **Supabase** (`dino-prod`) → **Authentication → URL Configuration**
   → **Site URL** → paste your URL → **Save**.
   - Below, **Additional Redirect URLs** → add `https://*.vercel.app/**`
     so future preview builds can also log in. **Save**.
3. **Cloudflare R2** → `tm-prod-public` → **Settings → CORS Policy**
   → **Edit** → replace `PLACEHOLDER.vercel.app` with your actual
   hostname (without `https://`) → **Save**.

### D7. Re-deploy so the new env vars take effect

Vercel → Project → **Deployments** tab → topmost row → **⋯** → **Redeploy** → confirm.

### D8. Smoke test + create the first super-admin

Wait ~2 minutes after the redeploy, then:

1. Open `https://<your-project>.vercel.app/` — the home page should load.
2. Open `https://<your-project>.vercel.app/register-super-admin`.
3. Email is pre-filled with the owner address (do not change).
4. Type a strong password (10+ chars) twice. Submit.
5. You're auto-signed-in and land on `/admin`.
6. Create a test event at **`/admin/events/new`** — the org dropdown
   should show **Tamil Nadu Arm Wrestling Association** (proves the
   `seed.sql` from B3 landed).
7. Register a fake athlete from the counter desk; upload a placeholder
   payment screenshot. A successful upload proves the R2 wiring.
8. Optional cleanup: delete the test event from `/admin/events`.

---

## Part E — Pushing changes (the routine, every future update)

This is the easy part. **The developer never has to "deploy" anything.**

### E1. Code-only changes (no database change)

```
1. Developer edits code on their laptop.
2. Developer commits and runs:   git push origin main
3. Vercel auto-builds and the new version is live in ~2 minutes.
```

That's it. You will see the new build appear in Vercel → **Deployments**.
A green tick = live. A red cross = something broke; the **previous**
version stays live (no downtime).

### E2. Changes that include a database migration

A "migration" is a new file in `supabase/migrations/` (e.g.
`0047_some_change.sql`). The bundled `schema.sql` is only used for
first-day setup — once `dino-prod` exists with real data in it, you
**never** re-paste `schema.sql` (it's idempotent but pointless).
Individual new migrations get applied one at a time.

**Critical order — never skip:**

```
1. Developer commits the migration + code together.
2. BEFORE pushing to main, the developer (or you) opens dino-prod
   → SQL Editor → pastes JUST the new file (e.g. 0047_*.sql) → Run.
3. THEN push to main → Vercel deploys the new code.
4. Developer also runs `npm run schema:bundle` and commits the
   refreshed `supabase/schema.sql` so future first-day setups stay
   one-paste.
```

Reverse order = website code expects a column that doesn't exist =
errors for users until the migration runs. The developer is responsible
for getting this order right; you (the operator) just need to know that
migrations are manual and intentional. See [PLAN-DEPLOY.md](PLAN-DEPLOY.md) §2.

### E3. Try a change before going live (preview URLs — free)

If the developer is unsure about a change, they push to a **branch**
instead of `main`:

```
git push origin try-new-thing
```

Vercel automatically builds it at a temporary URL like
`https://dino-arm-tourney-git-try-new-thing-yourname.vercel.app`. You
click around, confirm it works, then the developer merges to `main`.
Production only updates when `main` updates.

### E4. Roll back a bad deploy (one click)

1. Vercel → Project → **Deployments**.
2. Find the last green-tick deploy from **before** the bad one.
3. Click **⋯ → Promote to Production** → confirm.
4. Live again in ~10 seconds. No code changes needed.

---

## Part F — Match-day rules (mandatory)

Copied here for visibility — full version in [PLAN-DEPLOY.md](PLAN-DEPLOY.md) §5.

| When | What you do |
|---|---|
| **2 days before event** | Tell the developer: "freeze production". No new deploys to `main`. |
| **1 day before** | Run dress rehearsal against the production URL ([docs/dress-rehearsal.md](docs/dress-rehearsal.md)). Pre-cache photos on the venue laptop: `cd web; npm run cache:photos`. |
| **Event day** | If something breaks, the developer fixes on a `hotfix/...` branch, **you** open the preview URL on your phone and confirm it works, **then** they promote. Never push directly from a phone at the venue. |
| **Day after** | Tell the developer: "unfreeze". Normal deploys resume. |

---

## Part G — Health checks (do these monthly, takes 5 minutes)

All three free tiers degrade silently if you blow past them. Set a
phone reminder for the 1st of each month.

| Service | Where | Worry if… |
|---|---|---|
| Vercel | https://vercel.com → Project → **Usage** | any bar over 70% |
| Supabase (`dino-prod`) | Supabase → **Reports** | DB size > 350 MB, or egress > 3.5 GB |
| Cloudflare R2 | https://dash.cloudflare.com → **R2 → Metrics** | storage > 6 GB |

If any of these trip, send a screenshot to the developer. **Do not
upgrade to a paid plan** without asking — the design specifically fits
inside the free tiers ([PLAN-WEEK1.md](PLAN-WEEK1.md) §1.4) and a
sudden spike usually means a bug, not real growth.

---

## Part H — Disaster recovery

| Scenario | Recovery |
|---|---|
| Bad deploy broke the site | Part E4 (one-click rollback). |
| Bad migration broke the DB | Tell the developer. Supabase has **Point-in-Time Recovery** for the last 7 days on the free tier — they can restore from the dashboard. |
| Vercel is down (rare) | Use the Cloudflare Tunnel fallback in [PLAN-DEPLOY.md](PLAN-DEPLOY.md) §7. The venue laptop becomes the website. |
| Lost `prod-secrets.txt` | Each value is regeneratable: Supabase API keys can be rotated in **Settings → API**, R2 token in **R2 → API Tokens → Roll**. After regenerating, paste new values into Vercel **Environment Variables** and **Redeploy**. |

---

## Glossary (for non-technical readers)

- **Repository / repo**: the folder of code, stored on GitHub.
- **Branch**: a parallel copy of the code where the developer tries
  changes without affecting the live site. `main` = the live branch.
- **Deploy**: copying a version of the code onto Vercel's servers so
  the public can visit it.
- **Preview URL**: a temporary live website Vercel builds for every
  branch automatically. Free, throwaway, perfect for "looks-good-to-me"
  checks.
- **Migration**: a SQL file that changes the shape of the database
  (adds a table, a column, etc.). Numbered files under `supabase/migrations/`.
- **Environment variable**: a setting (URL, password, API key) the
  website reads at startup. Stored in Vercel, never in the code.
- **Service role key**: a Supabase password that bypasses all security.
  Only the server uses it. **Never paste it anywhere a browser can see.**

# Dino Arm Tourney — Master Plan

> **Codename:** `dino-arm-tourney`
> Federated, India-first tournament-management platform for arm wrestling
> (Panja). Built around the **Tamil Nadu State Arm Wrestling Championship**
> use-case, designed to scale from a 50-athlete district meet to a
> Pro-Panja-League-grade broadcast event — and to keep running when the
> venue's Internet doesn't.
>
> **Status (2026-04-30):** Live in production at `<vercel-app>` against
> Supabase project `dino-prod` + Cloudflare R2 `tm-prod-*`.
> The Week-1 MVP shipped, so did everything in PLAN-PARITY and Live-Fixtures.
> This document supersedes [archive/PLAN.md](archive/PLAN.md),
> [archive/PLAN-PARITY.md](archive/PLAN-PARITY.md), and
> [archive/PLAN-WEEK1.md](archive/PLAN-WEEK1.md), which remain as historical
> reference. Companion docs that are still live and binding:
> [PLAN-DEPLOY.md](PLAN-DEPLOY.md),
> [PLAN-LIVE-FIXTURES.md](PLAN-LIVE-FIXTURES.md),
> [PLAN-VERIFICATION.md](PLAN-VERIFICATION.md),
> [PLAN-AUDIT.md](PLAN-AUDIT.md) (bugs + vulnerabilities tracker).
> Operator/match-day SOPs: [DEPLOY-GUIDE.md](DEPLOY-GUIDE.md),
> [docs/match-day.md](docs/match-day.md),
> [docs/dress-rehearsal.md](docs/dress-rehearsal.md).

---

## 1. Vision (carried forward from archive/PLAN.md)

**One-line:** *The operating system for arm wrestling tournaments — from a
50-athlete TN district meet to an East-vs-West-grade PPV — that keeps
running when the Internet doesn't.*

### 1.1 Why we exist

Arm wrestling has world-class athletes and a fast-growing pro circuit, but
its operations are stuck in 2005: paper brackets, WhatsApp results,
disputes settled by the loudest voice. Generalist tooling (Smoothcomp,
Trackwrestling, Challonge, Toornament) assumes BJJ-style multi-mat
round-robins — none of them have single-table real-time scoring,
third-referee video review, structured protest workflows, or Indian
payment rails. Venues routinely have flaky 4G, ten-year-old laptops, and
the power going out at least once per event.

### 1.2 Product principles (non-negotiable)

1. **Local-first beats cloud-first** — every venue can finish its show
   with the WAN cable cut. The cloud is an eventually-consistent
   downstream.
2. **Append-only, audit-stamped** — no row of competitive truth can be
   silently edited. Every state change is an `audit_log` row with actor,
   payload, and timestamp.
3. **The head referee has no device** — humans call READY-SET-GO and the
   verdict; the system records and amplifies.
4. **Old hardware is the target, not the exception** — Core i3 / 4 GB /
   1366×768 must hit < 1.5 s first paint.
5. **Rules are data** — federations evolve their rulebooks; we ship a
   row, not a release. (Today we ship a constants file under
   `web/src/lib/rules/`. Promotion to per-event rule profiles is on the
   M2 roadmap.)
6. **India-first, not India-only** — UPI, GST, Aadhaar verification,
   bilingual UI ship now; SWIFT/Stripe layer on later.

### 1.3 Differentiators (the long-term wedge)

| # | Differentiator | Today | M1 | M2 |
|---|---|---|---|---|
| 1 | Multi-hub mesh across 2–8 tables | single-laptop console | LAN-only multi-operator already works | true sibling-hub gossip |
| 2 | Tamper-proof, hash-chained audit log | append-only `audit_log` | + signed JSONL export | + `dino-verify` auditor binary |
| 3 | Single-table-first match control (not a BJJ retrofit) | shipped | — | — |
| 4 | Built-in VAR (third-ref review) | — | clip-link uploads | Mux/LiveKit instant-clip |
| 5 | WAF-compliant protest workflow | — | manual flag + audit | full fee-debit + dual-ref panel |
| 6 | Razorpay Payouts w/ Section-194B TDS | — | — | shipped |
| 7 | Bilingual UI (EN + TA, then HI/TE/MR) | EN only | EN+TA | + HI |

---

## 2. Where we are today (2026-04-30 snapshot)

### 2.1 Stack as deployed

| Concern | Service | Notes |
|---|---|---|
| App runtime | Next.js 16 + React 19 + TS strict | Vercel Hobby, `web/` is the project root |
| Styling | Tailwind v3 (NOT v4) | `paper`/`volt` aliased to `bone`/`gold` |
| Database | Supabase Postgres (`dino-prod`, ap-south-1) | dev project `dino-dev` is laptop-only |
| Auth | Supabase Auth | operators only; athletes don't log in (token in URL) |
| Media | Cloudflare R2 (`tm-prod-public`, `tm-prod-private`) | dev pair `tournament-manager*` is laptop-only |
| PDFs | `@react-pdf/renderer` + `exceljs` for XLSX | generated on demand, never stored |
| CI | GitHub Actions `web-ci` (Node 22, `--ignore-scripts`) | `typecheck + test + build` blocks merge to `main` |
| Branch protection | ruleset `protect-main` | linear history, no force-push, no direct push to main |
| Deploy | `git push origin <branch>` → preview; merge → prod | freeze on operator's "freeze production" command |

### 2.2 Schema (44 migrations applied to `dino-prod`)

Everything from `0001_init.sql` through `0044_para_entry_fee.sql` lives
in `supabase/migrations/legacy/` and is bundled into
[supabase/schema.sql](supabase/schema.sql) by `npm run schema:bundle`.
A clean repo has **zero pending files at `supabase/migrations/*.sql`**;
new work lands at `supabase/migrations/<NNNN>_<topic>.sql` and moves
into `legacy/` after being applied to prod ([supabase/migrations/README.md](supabase/migrations/README.md)).

### 2.3 What's shipped (reverse-chronological, condensed)

The Week-1 MVP (registration, payment, weigh-in, fixtures, PDFs, audit
log, super-admin event/user management, R2 media pipeline, IndexedDB
offline queue, service worker) all landed and is in production. On top
of that the following modules went live:

| Area | Status | Notes / Repo memory |
|---|---|---|
| **Public registration** (`/e/<slug>/register`) | live | Para sub-form, photo upload (sharp 1080w q=75 strip-EXIF, ≤500 KB), Aadhaar-12 validation, mobile-10 regex, district allow-list |
| **Counter desk** (`/admin/counter`) | live | Bulk add via `BulkRegistrationDesk`, sticky channel toggle (online/offline), per-channel fees |
| **Fast operator console** | live | `FastRegistrationsTable`, debounced filters, multi-select w/ shift-range, sticky bulk bar, `j/k/x/v/r/Del/Enter/Esc` shortcuts, `ProofReviewModal` (left rail / right preview / verify-or-reject) |
| **Payments — full** | live | manual UPI + UTR + screenshot, partial collections (`payment_collections`, mig 0024), per-channel fees (mig 0036), waivers, adjust-total, undo-collect, district roll-ups, group-by-district view |
| **Payment proofs page** | live | Multi-proof per registration, signed URLs, image+PDF inline preview |
| **Weigh-in** | live | Webcam capture, scale-photo, second-operator co-sign hooks (PLAN-VERIFICATION §2 columns added later), bump-up checkbox (mig 0038), reweigh allowed within window |
| **Resolver + entries** | live | `web/src/lib/rules/resolve.ts` — non-para may produce up to 4 entries (Youth R/L + Senior R/L), para = single-arm; weight-bump-up bumps non-para to next bucket; full WAF 2025 code map |
| **Fixtures generator** | live | `bracket.ts` — single + double-elim, anti-clustering district swap in R1, byes auto-completed, GF without reset, mig 0022 `bracket_side` (W/L/GF) |
| **Live fixtures runtime** | live | Mig 0030–0035, `/admin/events/[id]/run` (`RunConsole`), per-table assignment, big A/B "wins game" buttons, best-of-N detection, end-by-method picker, `apply_fixture_complete` SECURITY DEFINER RPC routes winner+loser atomically and walkovers downstream byes |
| **Per-category bracket** | live | `/admin/events/[id]/categories/[code]` — interactive grid, in-progress green border |
| **Standings** | live | `web/src/lib/fixtures/standings.ts` — medal positions for single + double-elim, by-district roll-up, podium per category |
| **Public live spectator** | live | `/e/[slug]/live`, "Now playing" grouped per table, `<LiveRefresh>` polling fallback |
| **Print pack** | live | `/admin/events/[id]/print/{nominal,category,fixtures,id-cards,cash,payment}` — paginated previews, server-rendered PDFs + XLSX, ID cards 9-up A4 with signed photo URLs only for visible page |
| **Branding** | live | per-event logo/banner/colours/signatory editable from `/admin/events/[id]/edit` |
| **Audit log** | live | `/admin/audit` paginated viewer, actor + action filters auto-apply |
| **Users / RBAC** | live | super_admin / operator / weigh_in_official / federation_admin / referee / medical / accounts / organiser; invite-by-email (Supabase admin invite); last-super-admin guard; hard-delete (mig 0043) and soft-erase (mig 0042) |
| **Service worker + offline** | live | cache-first static, network-first HTML+API, fallback `/offline.html`; `dino-sync.queue` IDB store handles weigh-in + payment-verify/reject; SyncPill in header |
| **Perf optimisations** | live | `proxy.ts` middleware stamps headers (one Supabase RTT instead of two per page); 30 s LRU on profile; `event_dashboard(p_id_or_slug)` mega-RPC (mig 0019); category-sheet weigh_ins join fix (60 s timeout → 470 ms) |
| **Bracket format selector** | live | `events.bracket_format` honoured by `/api/fixtures/generate` (mig 0023) |
| **Chest-no allocator** | live | DB trigger (mig 0025) + district/team blocks (mig 0026) + start-at-1000 (mig 0041) |
| **Production deploy** | live since 2026-04-30 | branch protection on `main`, PR-only, squash/rebase merge, CI green required, hot-fix only via `hotfix/<slug>` during freeze |
| **Visual QA harness** | live | `web/scripts/readability-qa.mjs` — Playwright login + screenshot 5 surfaces × 2 viewports, console-error capture, horizontal-overflow detection |
| **Dress rehearsal** | done | `docs/dress-rehearsal.md`, run via `npm run rehearsal` |
| **PAFI rebrand** | done | mig 0021 (IAFF → PAFI strings) |

### 2.4 What is started but not finished

| Area | State | Where to pick up |
|---|---|---|
| **Field verifications (DOB / para / weight co-sign)** | spec only | [PLAN-VERIFICATION.md](PLAN-VERIFICATION.md) — migration `0041_field_verifications.sql` planned but not authored, not applied. UI hooks not wired. **Next migration number is `0045`** because 0041–0044 were taken (chest blocks / profile_erased_at / user_hard_delete / para_entry_fee). Renumber the verification mig to 0045 before authoring. |
| **`as any` cleanup in payment routes** | 18 occurrences | [PLAN-AUDIT.md §15](PLAN-AUDIT.md) |
| **Rate limiting on public endpoints** | absent | [PLAN-AUDIT.md §8](PLAN-AUDIT.md) — critical |
| **Bracket UI for L-bracket + GF** | partial | print previews still filter to `bracket_side='W'`; live console handles all sides |

---

## 3. Stakeholder model (live + planned)

The 15-persona model from archive/PLAN.md remains the long-term target.
Today we serve roles 1, 2, 3 (athlete = registrant, no login), 5, 11,
and indirectly 9 (announcer reads the spectator page). The rest land in
M1/M2 as features below land their dependencies.

| # | Persona | Surface today | Next |
|---|---|---|---|
| 1 | Tournament Organiser | `/admin/events`, dashboard | — |
| 2 | Federation Admin (TN AWA / PAFI / WAF) | shares `super_admin` role today | dedicated `federation_admin` dashboards (M1) |
| 3 | Athlete | `/e/<slug>/register`, `/e/<slug>/registered/<token>` | mobile PWA shell + draw view (M1) |
| 4 | Coach | — | team-roster view, opponent scout (M2) |
| 5 | Hub Controller / Scribe | `/admin/events/[id]/run` (`RunConsole`) | multi-table mesh (M2) |
| 6 | Head Referee | **no device** ✓ | — |
| 7 | Side Referee | — | tablet foul-tap (M2) |
| 8 | Third / Video Referee | — | clip-review console (M1 stub, M2 real) |
| 9 | MC / Announcer | `/e/<slug>/live` mirror | dedicated overlay surface (M2) |
| 10 | Medical Staff | — | waiver e-sign + on-stage incident log (M1) |
| 11 | Weigh-in Official | `/admin/events/[id]/weighin` | DOB + para + weight co-sign (M1, PLAN-VERIFICATION) |
| 12 | Spectator / Fan | `/e/<slug>/live` | — |
| 13 | Sponsor | branding fields per event | sponsor-tier surface + ROI report (M2) |
| 14 | Broadcast crew | — | RTMP + score-overlay JSON (M2) |
| 15 | Accounts / Payroll | partial — `payment_collections` rolls up | TDS/GST + Form 16A (M2) |

---

## 4. Architecture (current truth)

### 4.1 Single-source-of-truth diagram

```
                  ┌────────────────────────┐
   public web     │   Supabase dino-prod   │ ← single source of truth
  registration    │   Postgres + Auth      │
       │          └─────────┬──────────────┘
       │                    │ HTTPS
       │          ┌─────────┴──────────────┐
       │          │   Cloudflare R2        │ ← photos, screenshots, logos
       │          │   tm-prod-public       │   zero egress
       │          │   tm-prod-private      │
       │          └─────────┬──────────────┘
       │                    │
       ▼          ┌─────────┴──────────────┐
                  │   Vercel (Edge + λ)    │   match-day primary
                  │   Next.js 16 standalone│
                  │   middleware = proxy.ts│
                  └─────────┬──────────────┘
                            │ venue WiFi
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
           tablet 1     tablet 2       phone 3
           operator    weigh-in      counter desk
        (IDB queue)  (IDB queue)    (live)
```

The "venue laptop running its own Next.js" fallback from
[archive/PLAN-WEEK1.md](archive/PLAN-WEEK1.md) §1.6 is still on the
table for events without reliable WiFi but is **not the default** —
production is cloud-primary because the freeze-then-promote workflow
gives us better rollback than a laptop deploy.

### 4.2 Storage budget (verified, 2000-athlete event)

| Tier | Used / Free | Headroom |
|---|---|---|
| Supabase DB | ~35 MB / 500 MB | 14× |
| Supabase egress | DB-queries only, < 100 MB / 5 GB / mo | 50× |
| R2 storage | ~525 MB / 10 GB | 19× |
| R2 egress | 0 (free, always) | ∞ |

### 4.3 Discipline rules (still mandatory)

1. **Upload-time image compression.** `web/src/lib/image.ts` —
   sharp pipeline 1080w / JPEG q=75 / strip EXIF / reject > 500 KB /
   MIME allow-list (no SVG).
2. **Match-day photo pre-cache** is a step in
   [docs/dress-rehearsal.md](docs/dress-rehearsal.md) and
   [docs/match-day.md](docs/match-day.md). `npm run cache:photos`
   pulls everything into `web/public/cached/`.
3. **No PII in client-cached or browser-cacheable responses.**
   Aadhaar reveal is gated, audit-logged, `Cache-Control: no-store`.
4. **Service-role key never crosses to the client.** Confirmed by
   [PLAN-AUDIT.md §2](PLAN-AUDIT.md).

### 4.4 Performance budget

| Surface | Median TTFB target | Today |
|---|---|---|
| `/admin` dashboard | 350 ms | ≈ 290 ms (perf round 2) |
| `/admin/events/[id]` | 350 ms | ≈ 222 ms |
| `/admin/registrations` | 400 ms | ≈ 272 ms |
| `/admin/events/[id]/print/category` (300 athletes) | 1.5 s | ≈ 470 ms |
| `/e/[slug]/live` poll | 5 s freshness | ✓ |

Further squeezing requires RSC streaming or cross-page batching — not
on the immediate roadmap.

---

## 5. Roadmap

We use **Mx** instead of week numbers because the old "Week-N" framing
is what bit us in the rename: Week-1 is six weeks behind us, and naming
documents after a calendar window decays poorly.

### M0 — Production hardening (current sprint, fits inside the next freeze cycle)

Each item is one PR, behind branch protection, deployed by squash-merge
into `main`.

1. **Critical: rate limiting on public endpoints.** Pick one of:
   Upstash Ratelimit (free tier 10k req/day, Redis-on-edge) OR
   Vercel Edge Middleware in-memory token bucket (zero deps but
   per-region only, fine for our scale). Cover `/api/register`,
   `/api/payment/proof`, `/api/upload`, `/api/admin/users/invite`,
   `/api/login`, `/api/bootstrap-super-admin`. See
   [PLAN-AUDIT.md §8](PLAN-AUDIT.md).
2. **Type-safety pass on payment routes.** Define
   `PaymentWithRegistration`, `PaymentWithCollections` interfaces in
   `web/src/lib/payments/types.ts` and replace the 18 `as any` casts.
   Strictly typed nested Supabase joins also unblock future schema
   changes safely. ([PLAN-AUDIT.md §15](PLAN-AUDIT.md))
3. **Field verification UI** ([PLAN-VERIFICATION.md](PLAN-VERIFICATION.md))
   — author migration as `0045_field_verifications.sql` (renumber from
   the spec's 0041, which is taken). Wire DOB-stamp + Para-stamp tiles
   into `/admin/events/[id]/registrations` row drawer; add Weight
   co-sign tile to `/admin/events/[id]/weighin/[id]`. Audit actions:
   `registration.verify_dob`, `registration.verify_para`,
   `weighin.cosign`. No file upload (operator eyeballs ID; one
   exception: para certificate JPEG goes to R2 private bucket per
   PCI appeal requirement).
4. **L-bracket + GF UI on print previews.** Lift the
   `bracket_side='W'` filter on `/admin/events/[id]/print/category`
   and `/print/fixtures`. Render L and GF sections per category.
5. **Migration apply guard in CI.** A workflow step that fails the PR
   if `supabase/migrations/*.sql` (root, not legacy/) exists AND the
   PR description does not contain "Migration applied to prod ✓".
   Saves us from forgetting step 3 of the migration recipe.
6. **`docs/match-day.md` + `docs/dress-rehearsal.md` refresh** —
   update with prod URLs, freeze command (`<vercel> freeze`), and
   the new field-verification SOP once #3 lands.

### M1 — Field-event-grade (next 2–3 weeks of capacity)

| Feature | Why |
|---|---|
| **Mobile athlete PWA shell** | athletes today get one anonymous `/registered/<token>` page; M1 promotes that to an installable PWA with their own draw view, weigh-in slot, bracket. Backed by the existing `registrations.public_token` (mig 0011). No login. |
| **Draw publication + sealed-draw audit** | one-shot endpoint that snapshots the draw, hashes it, stores hash + actor in `audit_log` so a disputed bracket can be replayed byte-for-byte. |
| **Federation Admin role surfaces** | strip `federation_admin` from sharing the super-admin dashboard; give them: events they sanction, ranking points ledger (read-only stub for M1), approve-event button. |
| **Bilingual UI (EN + TA)** | `next-intl` or hand-rolled dictionary; first pass on registration form + ID card + spectator live page. Tamil glyphs already render in PDFs (Noto Sans Tamil bundled). |
| **Medical waiver e-sign** | one-page `/e/<slug>/waiver/<token>` — checkbox + draw-on-canvas signature → PNG to R2 private → flag on `registrations`. Blocks weigh-in if absent. |
| **Razorpay Standard Checkout (toggle per event)** | `events.payment_provider = 'razorpay'` already in schema (mig 0003 + 0018). Wire `/api/payment/razorpay/create-order` + webhook `/api/payment/razorpay/webhook`. Manual UPI stays default. |
| **Tamper-proof audit export** | nightly cron (Vercel cron) writes signed JSONL of `audit_log` to R2 private bucket; per-event "Download audit" button on `/admin/events/[id]`. Hash chain stub: each row carries `prev_hash`. |
| **Verification SLA dashboard** | counts of "DOB unverified" / "Para unverified" / "Weight unsigned" per event so the operator can clear them before draw publish. |

### M2 — Multi-event / multi-hub / pro-grade (quarter horizon)

| Feature | Why |
|---|---|
| **Multi-hub mesh** (the long-promised differentiator) | LAN gossip between sibling Hub laptops; each hub owns 1–4 tables; RunConsole already speaks per-mat, M2 just lets two RunConsoles share one event's category set without stepping on each other. Tech: Supabase Realtime channel-per-mat OR a tiny CRDT over WebRTC for the WAN-down case. |
| **Third-referee VAR clip review** | Mux video-on-demand instant-clip; LiveKit fallback. Link a clip to a fixture; "Verdict: Upheld / Denied" with audit row. |
| **Protest workflow** | ₹500 fee debit (Razorpay), dual-ref confirmation, 2-warnings = 1 foul, 2-fouls = loss; off-stage panel UI. |
| **Razorpay Payouts + Section 194B TDS + Form 16A** | bulk UPI/IMPS/NEFT to winners; automatic 31.2% TDS on prize money > ₹10k. |
| **Sponsor surface** | tier upload (Title / Powered-by / Weight-class / Table-side), broadcast-overlay JSON feed. |
| **`dino-verify` auditor binary** | Go or Node CLI: takes the JSONL export from M1 and verifies signatures + hash chain end-to-end. The federation lawyer's tool. |
| **Rule profiles (`rule_profile`) as data** | promote `web/src/lib/rules/` constants to a DB table per event, so a federation can ship a new rulebook without a redeploy. Existing constants become the seed for the `WAF-2025` profile. |
| **Bilingual phase 2** | Hindi, Telugu, Marathi. |
| **Self-host fallback documented** | `archive/PLAN-WEEK1.md §1.6` — Cloudflare Tunnel + venue laptop. M2 turns it into a one-script setup for organisers without reliable WiFi. |

### M3 — Reach (6-month horizon, demand-gated)

- IAFF/WAF national selection — multi-state roster ingest (CSV +
  signed-by-state-body track).
- Pro-Panja-League-grade overlays (broadcast crew gets RTMP keys +
  score-overlay JSON feed; replay export).
- Six-round super-match format (KOTT / Armfight rules).
- East-vs-West-style PPV super-match flow (8–16 athletes, 1 table,
  PPV billing integration — TBD provider).
- Auto-generated micro-site SEO (OG/Twitter cards) for every public
  event page.

### M4 — Outside Tamil Nadu

- Other states' federations onboarded (KAWA, MAWA …) via
  `federation_admin` role + sanctioning-body model.
- International rule profiles (IFA, EAF, …).
- SWIFT / Stripe payouts.

---

## 6. Out-of-scope (still — repeated from archive/PLAN.md)

- General combat sports (BJJ, MMA, kabaddi). Arm wrestling specifics
  (single-table cadence, foul math, weigh-in window) is what makes
  this product defensible.
- Custom hardware. Hubs run on commodity laptops + USB cameras.
- Athlete social network / feed / DMs.
- In-app sportsbook / fantasy.
- Real-time AI judging.

---

## 7. Risks & mitigations (live, not aspirational)

| Risk | Mitigation today |
|---|---|
| Prod Supabase free 500 MB ceiling | 35 MB used at 2000 athletes (7%). Headroom 14×. |
| R2 free 10 GB ceiling | 525 MB used at 2000 athletes (5%). Image compression gates the upload. |
| Public endpoints DOS / abuse | **Open** — rate limiting is M0 #1. ([PLAN-AUDIT.md §8](PLAN-AUDIT.md)) |
| Operator quits / hostile | Super-admin revokes role instantly; full audit; operators cannot delete payments/weigh-ins, only reject. Hard-delete (mig 0043) is super-admin-only. |
| Aadhaar PII leak | Stored full per mig 0015 (needed for federation submission), masked in UI by default, full reveal gated behind `?reveal=aadhaar` and audit-logged. R2 private bucket for proofs, signed URLs TTL 5 min, `Cache-Control: no-store`. |
| Two operators verify the same payment | DB guard + 409 from `apply_fixture_complete`-style atomicity. Sync queue drops 4xx (except 408/429). |
| Match-day WAN dies | Weigh-in + payment-verify queued in IDB. Public registration is closed by then anyway. RunConsole uses live `fetch` (NOT the queue) — match-day v1 expects venue WiFi at the table. |
| Bracket bug at the table | `bracket.ts` unit tests cover byes, odd counts, GF; `apply_fixture_complete` is SECURITY DEFINER + idempotent for same winner; `undo` super-admin-only and refuses if downstream `in_progress`/`completed`. |
| Vercel / Supabase outage | R2 cached photos still on the laptop; `web/public/cached/`; archive PLAN §1.6 fallback (Cloudflare Tunnel + local DB) documented as escalation path. |
| Forgetting the migration step | M0 #5 — CI guard. |
| Type drift in payment routes | M0 #2 — replace `as any`. |
| Migration breaks live event | Two-phase rollout discipline ([copilot-instructions §4a](.github/copilot-instructions.md), [supabase/migrations/README.md](supabase/migrations/README.md)) — additive PR A, backfill+drop PR B. |

---

## 8. Operating cadence

- **Default workflow** — `feat|fix|chore/<topic>` branch → PR → green
  CI → squash/rebase merge. Direct push to `main` is blocked by the
  `protect-main` ruleset.
- **Migration discipline** — additive + idempotent; apply to dev then
  prod; `git mv` to `legacy/`; `npm run schema:bundle`; commit.
- **Match-day freeze** — when the user says "freeze production",
  no merges to `main` until "unfreeze". Hot-fixes via
  `hotfix/<event-slug>` → preview → manual promote
  ([PLAN-DEPLOY.md §5](PLAN-DEPLOY.md)).
- **TDD** — red-green-refactor for behaviour changes
  ([tdd/SKILL.md](tdd/SKILL.md)).
- **Code-review** — own-diff pass on non-trivial PRs
  ([code-reviewer/SKILL.md](code-reviewer/SKILL.md)).
- **Plan hygiene** — when scope changes, update **this** file plus the
  matching companion (`PLAN-DEPLOY` / `PLAN-LIVE-FIXTURES` /
  `PLAN-VERIFICATION` / `PLAN-AUDIT`). Don't silently drift.

---

## 9. What success looks like (24-month horizon, restated)

- Every TN AWA district championship + the state championship runs on
  Dino end-to-end.
- The PAFI national selection runs on Dino with a signed audit export
  delivered to WAF.
- At least one PPL season uses our overlay + payout pipeline.
- Zero recorded incidents of disputed results that couldn't be
  resolved by replaying the event log.
- A federation lawyer has used `dino-verify` in a published ruling.

---

## 10. References

- Vision + persona model: [archive/PLAN.md](archive/PLAN.md)
- Original 7-day delivery sprint: [archive/PLAN-WEEK1.md](archive/PLAN-WEEK1.md)
- Parity-with-paper checklist: [archive/PLAN-PARITY.md](archive/PLAN-PARITY.md)
- Live-fixtures implementation: [PLAN-LIVE-FIXTURES.md](PLAN-LIVE-FIXTURES.md)
- Field verification spec: [PLAN-VERIFICATION.md](PLAN-VERIFICATION.md)
- Production deploy guide: [PLAN-DEPLOY.md](PLAN-DEPLOY.md), [DEPLOY-GUIDE.md](DEPLOY-GUIDE.md)
- Bug + vulnerability tracker: [PLAN-AUDIT.md](PLAN-AUDIT.md)
- Workspace policy: [.github/copilot-instructions.md](.github/copilot-instructions.md)
- Migration policy: [supabase/migrations/README.md](supabase/migrations/README.md)
- Operator runbook: [docs/match-day.md](docs/match-day.md)
- Dress rehearsal SOP: [docs/dress-rehearsal.md](docs/dress-rehearsal.md)
- Branch protection: [docs/branch-protection.md](docs/branch-protection.md)

# Dino Arm Tourney — Bug & Vulnerability Tracker

> **Generated:** 2026-04-30 by automated audit pass over the workspace.
> Each finding lists severity, location, description, and a one-line
> suggested fix. Living document — close items by linking the PR that
> fixed them and moving them to **§Closed** with a date.
>
> Audit scope: code at `web/src/**`, migrations under
> `supabase/migrations/legacy/**` (= `supabase/schema.sql` bundle),
> service worker `web/public/sw.js`, CI workflow `.github/workflows/test.yml`.
> Out-of-scope: archived code under `archive/**`, generated artefacts,
> dev-only seeders.
>
> Triage convention:
> - **critical** — data exfil, auth bypass, prod outage, or PII leak
> - **high** — exploitable in adversarial conditions, or correctness bug
>   that can corrupt match-day state
> - **medium** — hardening / typing / future-proofing; user-visible bug
>   in non-critical path
> - **low** — code-smell, perf nit
> - **info** — accepted risk / design decision; recorded for context

## Summary

| Severity | Count |
|---|---|
| critical | 4 |
| high | 1 |
| medium | 1 |
| low | 0 |
| info / accepted | 15+ |

**Top three things to fix next** (already on [PLAN.md §M0](PLAN.md)):

1. Rate limit the four public POST endpoints (§8 below).
2. Replace `as any` casts in payment routes with typed interfaces (§15).
3. Verify SVG / PDF MIME enforcement on the upload route does what we
   think it does, then add a regression test (§3 follow-up).

---

## 1. Auth / RLS

Status: **OK**. All sensitive tables have RLS enabled and policies
inspected.

| # | Severity | File | Finding | Fix |
|---|---|---|---|---|
| 1.1 | info | [supabase/schema.sql#L179](supabase/schema.sql#L179), [#L324](supabase/schema.sql#L324), [#L333](supabase/schema.sql#L333), [#L560](supabase/schema.sql#L560), [#L566](supabase/schema.sql#L566) | Public-read `using (true)` on `organizations`, `categories`, `category_assignments`, `entries`, `fixtures` — intentional for spectator view. | Document as accepted; revisit if any of these tables ever start carrying PII. |
| 1.2 | info | [supabase/schema.sql#L684](supabase/schema.sql#L684) | `registrations` self-insert restricted to `auth.uid() = athlete_id` AND event registration window. | None. Sound. |
| 1.3 | info | [supabase/schema.sql#L594](supabase/schema.sql#L594) | `payments` insert policy `with check (true)` — relies on API-side `registration_id` binding in [web/src/app/api/payment/proof/route.ts](web/src/app/api/payment/proof/route.ts#L20-L50). | If we ever add another insert path, tighten the policy to require `registration_id` ownership. |

## 2. Service-role key leakage

Status: **OK**.

| # | Severity | File | Finding | Fix |
|---|---|---|---|---|
| 2.1 | info | [web/src/proxy.ts#L61](web/src/proxy.ts#L61) | `SUPABASE_SERVICE_ROLE_KEY` used only in middleware + API routes; no `NEXT_PUBLIC_*` export. | None. |
| 2.2 | info | [web/src/app/api/bootstrap-super-admin/route.ts#L49](web/src/app/api/bootstrap-super-admin/route.ts#L49) | Bootstrap endpoint validates key presence at runtime; auto-disables once a super-admin exists. | None. |

## 3. Upload pipeline

Status: **OK**, with one regression test recommended.

| # | Severity | File | Finding | Fix |
|---|---|---|---|---|
| 3.1 | info | [web/src/lib/image.ts#L16-L19](web/src/lib/image.ts#L16) | MIME allow-list `{jpeg, png, webp, heic, heif}` — SVG rejected (anti-XSS). | None. |
| 3.2 | info | [web/src/lib/image.ts#L23](web/src/lib/image.ts#L23) | 500 KB cap enforced **after** sharp re-encode at q=75. | None. |
| 3.3 | info | [web/src/lib/image.ts#L63](web/src/lib/image.ts#L63) | EXIF stripped via `sharp(...).rotate().jpeg()`. | None. |
| 3.4 | info | [web/src/app/api/upload/route.ts#L27-L31](web/src/app/api/upload/route.ts#L27) | Per-purpose size caps: poster 4 MB, circular PDF 8 MB, payment proof 2 MB. | None. |
| 3.5 | info | [web/src/lib/storage.ts#L88-L94](web/src/lib/storage.ts#L88) | Presigned URL TTL 5 min. | None. |
| 3.6 | medium (follow-up) | [web/src/app/api/upload/route.ts](web/src/app/api/upload/route.ts) | No regression test asserting that an `image/svg+xml` upload is rejected and that a fake-PDF (image bytes with `.pdf` name) is rejected. | Add `web/src/app/api/upload/route.test.ts` with two negative cases. |

## 4. CSRF / role-guards on mutating endpoints

Status: **OK** (sampled).

| # | Severity | File | Finding |
|---|---|---|---|
| 4.1 | info | [web/src/app/api/admin/events/route.ts#L32](web/src/app/api/admin/events/route.ts#L32) | `requireRole('super_admin')` before body parse. |
| 4.2 | info | [web/src/app/api/admin/payments/bulk/route.ts#L32](web/src/app/api/admin/payments/bulk/route.ts#L32) | `requireRole('operator')`. |
| 4.3 | info | [web/src/app/api/admin/registrations/route.ts#L39](web/src/app/api/admin/registrations/route.ts#L39), [#L160](web/src/app/api/admin/registrations/route.ts#L160) | `requireRole('operator')` on each verb. |
| 4.4 | info | [web/src/proxy.ts](web/src/proxy.ts) | Middleware stamps role into `x-dino-role` header before any handler runs; `requireRole` reads from header. |

## 5. SQL injection

Status: **OK**. All RPC calls use named parameter objects.

| # | Severity | File | Finding |
|---|---|---|---|
| 5.1 | info | [web/src/app/api/fixtures/[id]/complete/route.ts#L64-L71](web/src/app/api/fixtures/%5Bid%5D/complete/route.ts#L64) | `svc.rpc("apply_fixture_complete", { p_fixture_id: id, p_winner: winner, ... })`. |

## 6. XSS

Status: **OK** in the active codebase.

| # | Severity | File | Finding | Fix |
|---|---|---|---|---|
| 6.1 | accepted | (none in active code) | No `dangerouslySetInnerHTML` under `web/src/**`. The single instance is in archived code at [archive/web/src/app/e/[slug]/thank-you/[chestNo]/page.tsx#L105](archive/web/src/app/e/%5Bslug%5D/thank-you/%5BchestNo%5D/page.tsx#L105) — not deployed. | If that page ever gets ported back, render the QR via `<img src=…>` of a server-generated PNG instead. |

## 7. Input validation

Status: **OK** on critical routes.

| # | Severity | File | Finding |
|---|---|---|---|
| 7.1 | info | [web/src/app/api/register/route.ts#L41-L56](web/src/app/api/register/route.ts#L41) | Hand-written guard: 10-digit mobile, 12-digit Aadhaar, TN-district allow-list, required category arrays. |
| 7.2 | info | [web/src/app/api/fixtures/[id]/complete/route.ts#L32-L47](web/src/app/api/fixtures/%5Bid%5D/complete/route.ts#L32) | Winner ∈ {A,B}, method allow-list, integer scores. |
| 7.3 | info | [web/src/app/api/weighin/route.ts#L41-L51](web/src/app/api/weighin/route.ts#L41) | JSON parse wrapped in try/catch; defaults to `null`. |
| 7.4 | info | [web/src/app/api/payment/proof/route.ts#L29-L30](web/src/app/api/payment/proof/route.ts#L29) | UTR regex `^\d{8,22}$`. |

## 8. Rate limiting — **CRITICAL, OPEN**

Status: **CRITICAL — none of the public POST endpoints throttle.**

| # | Severity | File | Finding | Fix |
|---|---|---|---|---|
| 8.1 | critical | [web/src/app/api/register/route.ts](web/src/app/api/register/route.ts) | Public POST. Attacker can flood the registrations table for any open event. | Per-IP token bucket: 5/min, 50/hr. Reject with 429. |
| 8.2 | critical | [web/src/app/api/payment/proof/route.ts](web/src/app/api/payment/proof/route.ts) | Public POST. No replay/DOS protection. | Per-`registration_id` cap (1 proof per 30 s) + per-IP cap. |
| 8.3 | critical | [web/src/app/api/upload/route.ts](web/src/app/api/upload/route.ts) | Public POST (called from registration flow). R2 free tier could be exhausted. | Per-IP 10/min; require `x-dino-uid` header (set by middleware) for non-public-purpose uploads. |
| 8.4 | high | [web/src/app/api/admin/users/invite/route.ts](web/src/app/api/admin/users/invite/route.ts) | Operator endpoint, but a compromised operator could spam invites. | Per-actor 20/hr; per-event 100/day. |
| 8.5 | high | [web/src/app/api/login/route.ts](web/src/app/api/login/route.ts) | (or whichever route Supabase Auth proxies through) — no brute-force throttle on top of Supabase's own. | Per-IP 10/min on failed attempts. |
| 8.6 | high | [web/src/app/api/bootstrap-super-admin/route.ts](web/src/app/api/bootstrap-super-admin/route.ts) | Already auto-disables after first super-admin, but unauthenticated POST during the bootstrap window. | Per-IP 5/min until disabled. |

**Recommended approach:** Upstash Ratelimit (Vercel-friendly, Redis-on-edge, free tier 10k req/day covers us). Wrap each route in
`web/src/lib/rate-limit.ts` exporting a `withRateLimit(handler, { window, max })` HOC.

## 9. Sync queue

Status: **OK**.

| # | Severity | File | Finding |
|---|---|---|---|
| 9.1 | info | [web/src/lib/sync/queue.ts#L174-L177](web/src/lib/sync/queue.ts#L174) | 4xx drop except 401/408/429 — sound. |
| 9.2 | info | [web/src/lib/sync/queue.ts#L96-L104](web/src/lib/sync/queue.ts#L96) | IDB quota error wrapped in typed message; surfaces in UI. |
| 9.3 | info | [web/src/lib/sync/queue.ts#L182](web/src/lib/sync/queue.ts#L182) | `flushPromise` singleton prevents concurrent flushes. |

## 10. Fixture engine

Status: **OK**, no remaining TODOs.

| # | Severity | File | Finding |
|---|---|---|---|
| 10.1 | info | [supabase/schema.sql#L939-L962](supabase/schema.sql#L939) | Mig 0033 fix for ambiguous `bracket_side` is in the bundle. |
| 10.2 | info | [web/src/lib/rules/bracket.ts#L44-L113](web/src/lib/rules/bracket.ts#L44) | Anti-clustering swap in R1 to avoid same-district pairings. |
| 10.3 | info | [web/src/lib/rules/bracket.ts#L196-L260](web/src/lib/rules/bracket.ts#L196) | Cross-half drop pattern for double-elim. |
| 10.4 | info | [web/src/lib/rules/bracket.ts#L150-L151](web/src/lib/rules/bracket.ts#L150) | No bracket-reset 2nd GF (per regional federations). |

## 11. Aadhaar / PAN PII

Status: **OK** with a documented gate.

| # | Severity | File | Finding |
|---|---|---|---|
| 11.1 | info | [web/src/app/api/admin/registrations/[id]/route.ts#L66-L80](web/src/app/api/admin/registrations/%5Bid%5D/route.ts#L66) | Default response carries `aadhaar_masked`. Full Aadhaar gated behind `?reveal=aadhaar`. |
| 11.2 | info | [web/src/app/api/admin/registrations/[id]/route.ts#L75-L80](web/src/app/api/admin/registrations/%5Bid%5D/route.ts#L75) | Every reveal logs `registration.aadhaar.reveal` to audit. |
| 11.3 | info | [web/src/app/api/admin/registrations/[id]/route.ts#L153-L157](web/src/app/api/admin/registrations/%5Bid%5D/route.ts#L153) | `Cache-Control: no-store, no-cache, must-revalidate, private`. |

## 12. Secrets in repo

Status: **OK**.

| # | Severity | Finding |
|---|---|---|
| 12.1 | info | `.env.local` and `.env.*.local` are gitignored. |
| 12.2 | info | No JWTs, Stripe `sk_live_*`, or R2 access keys found in committed files (grep over `eyJhbGc`, `sk_live`, `r2.cloudflarestorage.com`). |

## 13. TODO / FIXME / HACK markers

Status: **clean** in active code. Documentation comments referencing
"M1 …" or "later" are not blockers; they're roadmap pointers.

## 14. Skipped / focused tests

Status: **clean**. No `.skip(`, `.only(`, `xit(`, `xdescribe(` under
`web/src/**/*.test.ts`. The substring "skip" appears only in test
descriptions ("should skip invalid entries" — that's the assertion, not
a directive).

## 15. Type safety — `as any` in payment routes

Status: **MEDIUM, OPEN**.

| # | Severity | File | Finding | Fix |
|---|---|---|---|---|
| 15.1 | medium | [web/src/app/api/payment/proofs/[id]/route.ts#L43](web/src/app/api/payment/proofs/%5Bid%5D/route.ts#L43) | `(proof as any).payments` to extract embedded relation. | Define `interface PaymentProofWithPayment` and use it. |
| 15.2 | medium | [web/src/app/api/admin/payments/[id]/[action]/route.ts#L34](web/src/app/api/admin/payments/%5Bid%5D/%5Baction%5D/route.ts#L34) | same pattern. | Same. |
| 15.3 | medium | [web/src/app/api/admin/payments/[id]/collect/route.ts#L87](web/src/app/api/admin/payments/%5Bid%5D/collect/route.ts#L87) | same. | Same. |
| 15.4 | medium | [web/src/app/api/admin/payments/[id]/adjust-total/route.ts#L73](web/src/app/api/admin/payments/%5Bid%5D/adjust-total/route.ts#L73) | same. | Same. |
| 15.5 | medium | [web/src/app/api/admin/payments/bulk/route.ts#L152](web/src/app/api/admin/payments/bulk/route.ts#L152) | same. | Same. |

**Suggested centralisation:** create `web/src/lib/payments/types.ts`
exporting `PaymentRow`, `PaymentWithRegistration`,
`PaymentWithCollections`, `PaymentProofWithPayment`. Drop the casts.
This unblocks a future `npm run` type-only check that fails the build
on new `as any` introductions in the payment domain.

## 16. Pending migrations

Status: **clean**. Only `supabase/migrations/legacy/` and
`supabase/migrations/README.md` exist. No files at root.

If a future PR adds a migration, watch for:
- numeric prefix taken? (Last applied is `0044_para_entry_fee.sql`,
  next free is `0045`.)
- additive + idempotent? (`create … if not exists`,
  `add column if not exists`.)
- applied to prod **before** the PR merges?
- `git mv` to `legacy/` + `npm run schema:bundle` committed in the
  same PR?

## 17. N+1 query patterns

Status: **OK** (sampled). No `await` inside `.map()` in server
components or API routes. Bulk routes use Supabase embedded joins
(`registrations(…), payments!inner(…)`) instead of per-row fetches.

## 18. Service worker

Status: **OK**.

| # | Severity | File | Finding |
|---|---|---|---|
| 18.1 | info | [web/public/sw.js#L110](web/public/sw.js#L110) | Non-GET requests pass through (no cache pollution from POST). |
| 18.2 | info | [web/public/sw.js#L124-L130](web/public/sw.js#L124) | `/admin`, `/login`, `/auth`, `/edit` always passthrough. |
| 18.3 | info | [web/public/sw.js#L83-L92](web/public/sw.js#L83) | `/api/*` GET = network-first, fallback to cache. |

## 19. CI / supply-chain

| # | Severity | File | Finding | Fix |
|---|---|---|---|---|
| 19.1 | low | [.github/workflows/test.yml](.github/workflows/test.yml) | `npm ci --ignore-scripts` skips lifecycle scripts to dodge `canvas` build on Linux. Sharp ships prebuilt binaries via optional deps so no script needed. **However** any future dep that *does* legitimately need a postinstall (e.g. native module) will silently fail to install in CI. | Document this in the workflow comment (already there) and add a comment-banner above any new dependency PR description prompting "Does this dep need a postinstall script?". |
| 19.2 | medium | [.github/workflows/test.yml](.github/workflows/test.yml) | No `npm audit --audit-level=high` step. | Add a non-blocking `npm audit --audit-level=high` step, then a `--audit-level=critical` blocking step. |
| 19.3 | low | [.github/workflows/test.yml](.github/workflows/test.yml) | No migration-applied guard step (see [PLAN.md §5 M0 #5](PLAN.md)). | Add: fail PR if `supabase/migrations/*.sql` exists at repo root AND PR body lacks "Migration applied to prod ✓". |

---

## Closed

*(empty — close items here by linking the merge PR + date.)*

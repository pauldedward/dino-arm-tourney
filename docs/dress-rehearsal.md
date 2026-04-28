# Day 7 — Dress rehearsal sign-off

_Run date: 2026-04-22_

Final gate for Week 1 delivery. Per plan §5 Day 7: **no new features, fix
blocking bugs only, validate the full match-day pipeline.**

---

## 1. Automated gates (all green)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | ✅ clean |
| Unit tests | `npm test` | ✅ 33/33 pass (rules 16 · resolver 9 · bracket 8) |
| Sample seed | `npm run seed:sample` | ✅ 20 registrations upserted |
| End-to-end pipeline | `npm run rehearsal` | ✅ see §2 |

## 2. End-to-end rehearsal run

[web/scripts/dress-rehearsal.ts](../web/scripts/dress-rehearsal.ts) exercises
the full match-day pipeline server-side against real Supabase + real PDFs,
mirroring what `/api/fixtures/generate` + `/api/pdf/[kind]` do over HTTP.

Recorded run:

```
[event]         TN State Arm Wrestling Championship 2026
[registrations] paid=18  weighed_in=18
[entries]       inserted=36
[fixtures]      categories=31  fixtures=7
[pdf] nominal.pdf       7.0 KB
[pdf] category.pdf      9.7 KB
[pdf] id-cards.pdf     19.7 KB
[pdf] fixtures.pdf      5.7 KB
[pdf] pending-dues.pdf  2.6 KB
```

Output lives in `research/rehearsal-out/`. All 5 PDFs start with the
`%PDF-` magic bytes and open cleanly.

Sparse brackets (31 categories / 7 matches) are expected: 36 synthetic
athletes splinter finely across (division × age_band × weight × hand).
A real event with ~500 athletes will hit ~20-40 populated brackets.

## 3. Manual checks to do on match-eve

These need real hardware and are NOT automated:

- [ ] **Printer test** — print `id-cards.pdf` on real 300 gsm A4 card
      stock. Measure card size (should fill the 8-up layout). Confirm
      logo + chest-no are sharp at arm's length. Cut one, lanyard it.
- [ ] **UPI walkthrough** — have a volunteer pay ₹1 to the event's UPI
      id. Accounts desk goes to `/admin/events/<id>/registrations`,
      filters `status=pending`, clicks **Verify payment**. Confirm
      status flips to `paid` and an `audit_log` row appears at
      `/admin/audit` with `action=payment.verify`.
- [ ] **Weigh-in offline drill** — on a phone, open `/admin/weighin`,
      turn airplane mode ON, submit 2 weigh-ins. Header pill should
      read `2 queued`. Turn airplane mode OFF — pill should flush to
      `All synced` within 30 s. Confirm both rows now exist in DB and
      both registrations advanced to `weighed_in`.
- [ ] **Photo pre-cache** — `npm run cache:photos -- --event=<uuid>`
      on the venue laptop. Confirm `web/public/cached/` fills up. Pull
      the Ethernet cable. Confirm `/admin/events/<id>/registrations`
      still renders with the cached photos.
- [ ] **LAN reachability** — laptop on `npm start -- -H 0.0.0.0`, get
      the LAN IP, open it on 3 different volunteer phones.
- [ ] **Last-super-admin guard** — try to demote yourself in
      `/admin/users`. Expect refusal.

## 4. Go / no-go

Go if all four automated gates are ✅ and the six manual checks above
are done on the actual venue laptop + printer. Match-day runbook is
[docs/match-day.md](match-day.md).

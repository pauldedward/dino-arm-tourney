# Dino Arm Tourney — Master Plan

> **Codename:** `dino-arm-tourney`
> An end-to-end, India-first tournament management platform purpose-built
> for arm wrestling (Panja). WAF-rulebook compliant, Pro Panja
> League-grade production, designed to run anything from a Tamil Nadu
> district championship to an East-vs-West-style PPV super-match — and
> to keep running when the venue's Internet doesn't.

This document is the source of truth for the product. Research citations
live in [research/00-synthesis-input.md](research/00-synthesis-input.md). A
heavy DeepResearch report (id `cb8ffb0f-5c7a-44b6-b075-edfafd9e58f4`) is
generating in the background and will append additional citations.

**Reading order:** §1 sets the why and the differentiators. §3 walks the
lifecycle. §11–§12 define the multi-hub mesh and tamper-proof event log
— the two architectural decisions everything else follows from.

---

## 1. Vision & Positioning

**One-line:** *The operating system for arm wrestling tournaments — from a
50-athlete Tamil Nadu district meet to an East-vs-West-grade PPV — that
keeps running when the Internet doesn't.*

### 1.1 The problem

Arm wrestling has world-class athletes and a fast-growing pro circuit, but
its operations are stuck in 2005:

- **Federations** (IAFF, TN AWA, most state bodies) run brackets on paper,
  weigh-in logs in notebooks, and report results over WhatsApp. Disputes
  are settled by the loudest voice in the room. (`research/03-india-tn.json`)
- **Pro events** (East vs West, KOTT, Top-8, Zloty Tur, **Pro Panja League**)
  air on Sony Sports / DD / FanCode / SportVot but every event reinvents
  its overlays, replay rig, and payout pipeline with bespoke vendors.
  (`research/02-pro-events.json`)
- **Generalist tooling** (Smoothcomp, Trackwrestling, Challonge, Toornament,
  Tournify) assumes BJJ-style multi-mat round-robins. None of them have
  single-table real-time scoring, third-referee video review, structured
  protest workflows, or Indian payment rails. (`research/04-existing-software.json`)
- **Venues** \u2014 community halls, college auditoriums, Marina-side stages \u2014
  routinely have flaky 4G, no fibre, ten-year-old laptops, and the power
  goes out at least once per event.

### 1.2 What we're building

A federated, **local-first** platform whose live-day surface (the
multi-table **Category Hub** mesh) is the source of truth, with a cloud
control-plane sitting on top for everything that genuinely needs the
Internet (registration, payments, KYC, ranking, broadcast fan-out,
sponsor reporting).

The product spans the full lifecycle:

> announcement \u2192 registration \u2192 qualification \u2192 weigh-in \u2192 draw \u2192
> bracket execution \u2192 referee crew & video review \u2192 protest adjudication \u2192
> live broadcast \u2192 prize disbursement (with TDS/GST) \u2192 archive & ranking.

Rules are **data, not code** \u2014 a `rule_profile` row defines weight
classes, foul list, warning math, protest fee, video-review eligibility,
and weigh-in window. WAF-2022, IAFF-2024, PPL-S2, EvW, KOTT and
organiser-defined `CUSTOM` profiles all coexist on the same engine.

### 1.3 Product principles (non-negotiable)

1. **Local-first beats cloud-first.** Every venue can finish its show with
   the WAN cable cut. The cloud is an eventually-consistent downstream.
2. **Append-only, signed, hash-chained.** No row of competitive truth can
   be silently edited or deleted. Tamper-proof is a deliverable, not a
   marketing word \u2014 see `dino-verify` (\u00a712.8).
3. **The head referee has no device.** Human authority calls READY-SET-GO
   and the verdict; the system records and amplifies. We never let
   software stand between the athletes and the ref's voice.
4. **Old hardware is the target, not the exception.** Core i3 / 4 GB /
   1366\u00d7768 must hit < 1.5 s first paint and < 500 ms p95
   result-to-spectator-screen on LAN.
5. **Rules are data.** Federations evolve their rulebooks; we ship a row,
   not a release.
6. **India-first, not India-only.** UPI, Razorpay payouts, GST, 194B TDS,
   bilingual UI ship in M0\u2013M1; SWIFT/Stripe and other federations layer
   on later without rework.

### 1.4 Differentiators (what nobody else has)

1. **Multi-hub mesh** \u2014 5\u201312 weight categories run in parallel across
   2\u20138 physical tables, each owned by its own Category Hub, gossiping
   over the venue LAN. Sibling hubs are also each other's backup. (\u00a711)
2. **Tamper-proof event log** \u2014 every state change is one signed,
   hash-chained, schema-validated row that lives in at least three
   places before we say \"saved\". An auditor binary verifies the entire
   tournament from a JSONL export. (\u00a712)
3. **Single-table-first match control** \u2014 not a retrofit of BJJ
   multi-mat tooling.
4. **Built-in VAR** for the third referee \u2014 Mux instant-clipping (~1 s)
   with a local 60-second rolling buffer fallback when WAN is dead.
5. **WAF-compliant protest workflow** \u2014 \u20ac50 / \u20b9500 fee, dual-ref
   confirmation, 2-warnings = 1 foul, 2-fouls = loss, off-stage panel.
6. **Razorpay Payouts** \u2014 UPI/IMPS/NEFT bulk, automatic Section 194B
   TDS (31.2 %) and Form 16A on prize money > \u20b910,000.
7. **Bilingual** (English + Tamil at launch; Hindi, Telugu, Marathi soon)
   \u2014 critical for district adoption in TN, MH, AP.

### 1.5 Target segments (in priority order)

| # | Segment | First-event size | Why they buy |\n|---|---|---|---|\n| 1 | **Tamil Nadu district & state organisers** | 50\u2013300 athletes, 1\u20133 tables | Replace paper brackets and WhatsApp reporting; bilingual UI |\n| 2 | **State federations** (TN AWA, KAWA, MAWA\u2026) | 200\u2013800 athletes, 2\u20134 tables | Sanctioning, ranking points, audit trail for disputed bouts |\n| 3 | **IAFF national selections** | 500\u20131,500 athletes, 4\u20138 tables | Multi-hub parallelism, signed audit export to WAF |\n| 4 | **Pro Panja League / franchise events** | 16\u201364 athletes, 1\u20132 tables, broadcast | Production-grade overlays, VAR, payout automation |\n| 5 | **International super-matches (EvW / KOTT)** | 8\u201316 athletes, 1 table, PPV | Single-table polish, instant clip review, sponsor reporting |\n\nWe will ship for segments 1\u20132 first \u2014 they have the volume, the pain, and\nthe least incumbent software to displace.

### 1.6 Non-goals (what we will *not* do)

- **General combat sports.** No BJJ, no MMA, no Kabaddi. Arm wrestling\n  has unique rules and a single-table cadence; trying to be everything\n  is how every previous attempt at this got stuck.\n- **Custom hardware.** No proprietary referee buzzer, no in-house elbow\n  pads. Hubs run on commodity laptops + USB cameras.\n- **Athlete social network.** Profiles, yes; feed, DMs, follows \u2014 no.\n- **In-app sportsbook / fantasy.** Compliance cost in India is\n  prohibitive and not our circle of competence.\n- **Real-time judging by AI.** We provide the recording, the clip, and\n  the chair \u2014 humans rule.

### 1.7 What success looks like (24-month horizon)

- Every TN AWA district championship and the state championship use Dino.\n- IAFF National Selection runs on Dino with a signed audit export to WAF.\n- At least one PPL season uses our overlay + payout pipeline end-to-end.\n- Zero recorded incidents of disputed results that couldn't be resolved\n  by replaying the event log.\n- A federation lawyer has used `dino-verify` in a published ruling.

---

## 2. Stakeholder Map (15 personas)

Source: `research/06-personas.json` plus the multi-hub model (§11). Each
gets its own role + dashboard.

| # | Persona | Primary surface |
|---|---|---|
| 1 | Tournament Organiser | Web (desktop) — Event creator, schedule, dashboard |
| 2 | Federation Admin (IAFF / TN AWA / WAF) | Web — Approvals, sanctioning, ranking points |
| 3 | Athlete | Mobile PWA — Profile, registration, draw, weigh-in slot, protest |
| 4 | Coach | Mobile PWA — Team roster, opponent scout, in-stage assist |
| 5 | **Category Hub Controller / Scribe** | Hub laptop kiosk — Owns one category's bracket; calls athletes; records the head-ref's verdict |
| 6 | Head Referee | **No device** — Voice + hand signals at the table |
| 7 | Side / Assistant Referee | Tablet (optional) — Foul tap, dual-confirm |
| 8 | Third / Video Referee | Desktop — Replay scrubber, multi-cam, verdict console |
| 9 | MC / Announcer | Tablet — Now-on-table, intros, weight-class banner |
| 10 | Medical Staff | Mobile — Waivers, on-stage incident log |
| 11 | Weigh-in Official | Mobile — Scale entry with photo evidence, 24–30 hr window |
| 12 | Spectator / Fan | Mobile + Web — Live scores, brackets, stream embed |
| 13 | Sponsor | Web — Logo upload, broadcast-overlay placements, ROI report |
| 14 | Broadcast / Streaming Crew | Web — RTMP keys, score-overlay JSON feed, replay export |
| 15 | Accounts / Payroll | Web — Payouts, TDS, GST invoice, Form 16A, payslips |

---

## 3. End-to-End Lifecycle of a Tournament

```
Phase 0 ─► Sanctioning  ─► Phase 1 Announce ─► Phase 2 Register & Pay ─►
Phase 3 Weigh-in ─► Phase 4 Draw/Seed ─► Phase 5 Live Day(s) ─►
Phase 6 Protests/Adjudication ─► Phase 7 Results & Ranking ─►
Phase 8 Payouts (TDS/GST) ─► Phase 9 Archive & Highlights ─► Phase 10 Audit
```

### 3.1 Sanctioning (Federation-level)
- Federation admin creates a **sanctioning body** (WAF, IAFF, TN AWA, district body) and a **calendar** of approved events.
- Organisers submit event for approval → federation issues a sanction code (auto-published on public calendar).
- **Ranking Points engine** (WAF style: 10-7-5-4-3-2-1 for top 7) automatically allocated on result publish.

### 3.2 Announcement & Marketing
- Hosted public micro-site per event (`/e/<slug>`) — auto-generated, brand-customisable, OG/Twitter cards.
- WhatsApp / Email / SMS broadcast to past athletes + region filter (e.g., all Chennai athletes 70-80 kg).
- Sponsor tiers (Title, Powered-by, Weight-class, Table-side) with auto-generated branding kit.

### 3.3 Registration & Payment (multi-track)

At nationals/states the rosters mostly arrive **from the state body, not from
individual athletes**. We support three parallel tracks, with a single
`registration` row and a clear `source` field on each:

| Track | Who enters | Authorisation | When |
|---|---|---|---|
| **State roster upload** | State federation admin (CSV, or web form) | Auto-approved by virtue of state body's role | Open → close (T-30 to T-7 days) |
| **Athlete self-registration** | Athlete on PWA | **Pending** until federation approves | Open → close (T-30 to T-3 days) |
| **On-spot registration** | Welcome desk (kiosk PWA) | **Pending** until on-duty governing-authority officer taps APPROVE on their device — nothing else | At the venue, before weigh-in window opens |

Key design points:

- **Pre-loaded by category.** By the time the weigh-in counter opens, every
  registered athlete is already in the system with category, weight class,
  state, photo placeholder, and a printable QR. The weigh-in operator does
  *not* type names. They scan and update.
- **PAN + Aadhaar mandatory** when expected prize > ₹10k (Section 194B).
- **Coach/team batch registration** by CSV with row-level validation; failed
  rows are returned in the same CSV with an error column — organisers
  copy-paste fix and re-upload.
- **Razorpay Standard Checkout** for entry fees with GST 18 % auto-added.
  Free for state-roster track if the state body has a prepaid tab.
- **Refund / waitlist / age-class auto-assignment from DOB** — no manual
  reclassification.
- **Medical waiver e-sign + insurance upload** — blocking; you cannot weigh
  in without it green.

Every approval, rejection, and on-spot addition is one signed event in the
log (`registration.submitted`, `.approved`, `.rejected` — see §12.2.1) so a
disputed entry is always traceable to the officer who waved it through.

### 3.4 Weigh-in (the highest-friction phase — must not crash)

Weigh-in is where every previous attempt at this product fell over: the
laptop hangs, the page won't load, the queue snakes around the hall and
the operator is shouting names. Two design choices fix it.

**Choice 1 — the weigh-in station runs entirely on the venue LAN.** It is a
PWA served by the local hub at `http://weighin.local`. No cloud round-trip
is on the critical path. Pull-to-refresh, page reload, accidental close —
all return to the same row in < 1 s because the data is already on disk.

**Choice 2 — the operator's job is reduced to scan → weigh → photo.** They
never pick a category, never type a name, never search a list. The QR they
scan *is* the row.

**Slot booking** (24–30 hours before competition, WAF §1.4) is per athlete;
the roster shows up at their slot's window grouped by state.

**At the counter (one screen, three taps):**

```
1. Operator scans athlete's pre-printed QR        → row opens
2. Athlete steps on scale; operator taps WEIGHT
   number pad with kg + 1 decimal (large keys)
   Photo of the scale display is auto-captured
   from the counter's USB webcam at the same tap
3. Athlete looks at the counter camera; LIVE PHOTO
   captured; operator taps CONFIRM
   → ID card prints on the counter's USB label printer
```

The single "CONFIRM" tap emits one `weigh_in.recorded` event with
`{ athlete_id, kg, scale_photo_hash, live_photo_hash, signed_by }`.
The ID card is a 100 mm × 70 mm card carrying:

- Athlete name + state (large)
- Live photo (just captured)
- **Category code** (e.g. `M-80-R` = Senior Men 80 kg right hand)
- **Bracket code** (e.g. `MS80R`) and seed-position placeholder
- A **QR code** that encodes only `{ event_id, athlete_id, signature }` —
  no PII. Verifiable offline by any hub from its enrolled keys.
- A **Code-128 barcode fallback** of the same payload for cheap laser
  scanners that handle 1D much faster than 2D.

**Category change at weigh-in (the governance flow)**

The default rule is: **no category changes at weigh-in**. The system blocks
them on every regular operator tap. But in practice a registered 80 kg
athlete may be unfit, and a registered 85 kg or a fresh on-spot entry may
need to fill the slot. We make this flow explicit instead of accidental:

```
State/team head taps "Request reassignment" on their device
    │  payload: { from_athlete?, to_athlete, target_category, reason }
    ▼
Governing-authority officer (chief ref / weigh-in chief) sees a
pending-reassignment row in their tablet, with both athletes' weigh-in
records side by side
    │  taps APPROVE  (requires PIN)
    ▼
System checks:
  · target athlete's recorded weight is within target category ± grace
  · source athlete (if any) hasn't already competed
  · no duplicate seed in target bracket
    │  if any check fails → officer must enter a written override note
    ▼
Emits `registration.reassigned` (signed) + reprints both ID cards
  with the new category code; old QRs are revoked in the hubs' caches
```

Nothing else can move an athlete between categories. Even an organiser
cannot — the only path is through the on-duty governing-authority officer,
logged forever.

**Reliability features baked in**

- **Pre-loaded data** from the cloud control-plane is mirrored to every
  hub's SQLite the night before. Day-of registration deltas stream over
  the LAN.
- **Two operators in parallel per counter** if queues build — a second
  laptop joins the same hub via LAN; both see the same queue with
  per-row locks (one operator at a time per athlete).
- **Offline-tolerant weigh-in**: the entire weigh-in can be conducted with
  the WAN cable cut. Cloud catches up later.
- **Auto-lock** when the weigh-in window closes — final list signed off
  by the chief, triggers draw generation in the cloud (or locally if WAN
  is down).
- **Reweigh allowed within window**: emits `weigh_in.reweighed` — prior
  record is preserved (append-only), not overwritten.

### 3.5 Bracket / Draw Generation
- **Double-elimination** (WAF default), single-elimination, round-robin, **Top-8 no-loser** (every place wins prize), **Six-round super-match** (KOTT/Armfight format), **Pro Panja League** (double round-robin → playoffs).
- Random draw with **teammate-separation** rule (WAF §5.1).
- Seeding by ranking points (federation-level) + manual override.
- Re-draw audit log (cryptographic hash of seed for dispute defence).

### 3.6 Live Day — The Core Module

Live day runs as a **federated mesh of Category Hubs** (see §11). Several
divisions (e.g. Senior Men 80 kg, Senior Women 60 kg, Junior 18, Para-arm)
proceed in parallel. **One hub may own one or several adjacent tables**
(typical setup: one hub controller laptop manages 2 tables side by side,
4 if the operator is experienced and bouts are short — see §11). Roles
are split deliberately:

| Role | Device | Job |
|---|---|---|
| **Category Hub Controller** | One laptop next to its 1–4 tables | Owns the brackets for its categories. Calls athletes to a specific table by name + table number. Records the head-ref's verdict via QR scan. Advances the bracket. Triggers protests. **Source of truth for its categories.** |
| **Head Referee** | At the table — *no device* | Calls **READY → SET → GO!** by voice and hand. Declares fouls and pin verdicts by voice and hand-signal. Authority is human, not digital. |
| **Side / Assistant Referee** | Optional tablet | Confirms or disputes head-ref calls; logs fouls. |
| **Hub Scribe** (often the controller themselves) | Same hub | Translates the head-ref's verbal verdict into the hub UI in ~2 s. |
| **Third / Video Referee** | Hub-attached or central VAR console | Reviews replay only when a protest is raised. |
| **MC / Announcer** | Tablet mirroring the hub's "now on table" panel | Calls names, table numbers, results, protests as they appear. |

**The QR-scan match cycle (the simple, reliable flow)**

Every match is one loop, performed at the table itself, never typed:

```
1. Hub picks the next pair from the bracket and announces:
   “Table 2: M-80 quarter-final — Karthik (TN) vs Singh (PB).”
   → names + photos + table number flash on the table's LED + MC tablet

2. Both athletes report to Table 2; head-ref does READY-SET-GO

3. Head-ref declares the winner verbally

4. Scribe (or the winner himself, supervised) presents the WINNER's
   ID card to the hub's USB scanner
   → single beep = recorded
   → hub emits `match.result` { winner_qr, table, mode=pin/foulout }
   → bracket auto-advances; loser is sent to losers' bracket or out

5. Hub immediately announces the next pair for that same table
```

No typing. No category picking. No drop-downs. The QR *is* the answer.
A mis-scan is one tap of UNDO within 5 s. A dispute opens a protest;
otherwise the bracket marches on.

**Match Control (Hub UI — one screen for all the controller's tables)**

- A row per controlled table, each with the **NOW ON TABLE** card:
  the called pair's names, photos, weight class, bracket position.
- The big button per table is **SCAN WINNER** (the controller is already
  holding the scanner; this button just arms the next scan to that table).
- Foul buttons are present but secondary — used by the scribe only when
  the head-ref calls a foul out loud.
- Warning ledger (2 warnings = 1 foul, 2 fouls = loss). Hub *displays*
  the count; head-ref's voice is still final authority.
- **5-second undo grace period** on every result.
- One-tap **"Call next pair"** per table; queue-skip for re-weigh-in or
  medical hold; one-tap **"Move bout to other table"** if one table is
  free and the other is jammed.
- **Read-only mirror** of every other hub's now-on-table cards in a side
  panel — controllers can see what the room is doing without leaving
  their kiosk.

**Live Scoreboard** — fan-out from each hub via the local Hub Sync Server
(§12) → the table's own LED, the venue's main LED, the MC overlay, the
broadcast JSON feed, and the public spectator app. End-to-end target:
**≤ 1 s on LAN; ≤ 5 s when WAN is healthy; queued indefinitely when WAN
is dead** — the show never stops because the Internet does.

**On-screen athlete identity** — the live photo captured at weigh-in is
the single source of truth for the face shown on the table LED, the MC
overlay, and the broadcast graphic. Names are rendered in the athlete's
preferred script (Tamil/Hindi/English) chosen at registration.

**Officials Comms** — LiveKit push-to-talk when bandwidth allows; falls
back to a **LAN-only WebRTC mesh** (no STUN/TURN to the cloud) between
hubs and the central comms console for the duration of any WAN outage.
Recorded to the local hub disk for audit.

### 3.7 Protest & Video Review (third-referee VAR)

This is the **core wedge** vs. existing software.

```
Athlete/Coach raises protest in app
     │  (₹500 or €50 fee debited from wallet/Razorpay)
     ▼
Match auto-paused, head-ref notified
     ▼
Third Referee Console:
  ├─ Multi-cam view (table-cam, elbow-cam, head-cam)
  ├─ Mux instant-clip (last 30 s, sub-1-s availability)
  ├─ Frame-by-frame scrub + slow-mo
  ├─ Snickometer-style audio spike (slap detection)
  └─ Verdict: UPHELD (fee refunded) / DENIED (fee retained)
     ▼
Decision pushed to head-ref, athlete app, broadcast overlay
     ▼
Audit log (immutable) → archived with match video
```

Off-stage adjudication panel for procedural protests (WAF §4.1.11).

### 3.8 Results, Ranking, Awards
- Auto-bracket progression on each pin/foul-out.
- Final placings → ranking-point ledger (WAF point table) → federation leaderboard.
- Auto-generated certificates (PDF, vernacular) + medal/trophy print sheet.

### 3.9 Payouts & Compliance (India-first)

| Payment | Engine | Tax |
|---|---|---|
| Prize money | RazorpayX Bulk Payouts (UPI/IMPS/NEFT) | **TDS 31.2 % under §194B** if > ₹10,000 (`07-india-compliance.json`) |
| Referee/staff salary | RazorpayX Payroll | TDS §192 + payslip PDF |
| Sponsor invoice | Razorpay Invoices | **GST 18 %** on sponsorship (reverse-charge) |
| Entry fee refund | Razorpay Refund API | Pro-rata GST credit |

Auto-generates **Form 16A** per athlete each quarter.

### 3.10 Archive, Highlights, Distribution
- Every match video (full + Mux instant-clip highlights) stored in cold storage.
- Auto-generated 30-second highlight reel per match (pin moment ± 10 s).
- Athlete profile shows **career match library** (huge for sponsorship pitches).
- Public API for federations + media partners.

---

## 4. WAF Rule Compliance Engine (built-in)

A first-class module — every event inherits a **rule profile**. Profiles ship for:

- `WAF-2022` (default for sanctioned international)
- `IAFF-2024` (Indian national)
- `PPL-S2` (Pro Panja League franchise league)
- `EvW` / `KOTT` (super-match)
- `CUSTOM` (organiser-defined)

A profile encodes: weight categories (Senior M/W, Junior 18, Junior 21, Masters 40+, Grand-Masters 50+), bracket type, time limits (none for WAF, 6 rounds for KOTT), foul list, warning math, protest fee/currency, video-review eligibility, weigh-in window, anti-doping flag.

**This is what makes us defensible** — competitors hard-code one ruleset; we treat rules as data.

---

## 5. Information Architecture (top-level)

```
/                              — marketing site
/e/<slug>                      — public event page
/e/<slug>/bracket              — live bracket
/e/<slug>/live                 — spectator live view (scores + stream)
/e/<slug>/register             — athlete registration

/app                           — authenticated shell
  /app/events                  — organiser: my events
  /app/events/<id>             — event dashboard
  /app/events/<id>/registrations
  /app/events/<id>/weigh-in
  /app/events/<id>/draw
  /app/events/<id>/schedule
  /app/events/<id>/control     — match-control (referee)
  /app/events/<id>/var         — third-referee console
  /app/events/<id>/protests
  /app/events/<id>/payouts
  /app/events/<id>/archive

  /app/athlete                 — athlete area (registrations, wallet, results)
  /app/federation              — federation admin
  /app/finance                 — accounts/payroll
```

---

## 6. Data Model (high-level)

Postgres (Supabase) with RLS. Core entities:

`organizations`, `federations`, `users`, `roles_per_org`, `athletes`, `athlete_kyc`, `events`, `rule_profiles`, `weight_classes`, `divisions`, `registrations`, `payments`, `weigh_ins`, `brackets`, `matches`, `match_events` (every Ready/Go/Foul/Pin), `protests`, `protest_evidence`, `video_clips`, `referees`, `referee_assignments`, `comms_channels`, `prize_pools`, `payouts`, `tds_records`, `gst_invoices`, `payslips`, `ranking_points`, `audit_log`.

**Edge-plane additions (see §11–§12):** `categories`, `tables`, `hubs`,
`hub_devices`, `hub_keys`, `category_assignments` (which hub owns which
category at which moment), and the cross-cutting **`event_log`** table
(append-only, hash-chained, signed). All mutations on `matches`,
`protests`, `payouts`, `weigh_ins`, `registrations` are derived
projections of `event_log` rows. RLS enforces: athletes see only their
data; referees see only their assigned matches; hubs may only emit
events for categories assigned to them; federation admins see only their
sanctioned events.

---

## 7. Technical Architecture

We run **two cooperating planes**: a cloud control-plane for everything
that needs Internet, and a venue **edge-plane** that survives the
Internet dying mid-show.

```
             ┌──────────────────────────────────────────┐
             │       CLOUD CONTROL-PLANE                │
             │  Next.js 15 (App Router, RSC, Server     │
             │    Actions, PWA + Service Worker)        │
             │  Supabase: Postgres+RLS, Realtime, Auth, │
             │    Storage, pg_cron                      │
             │  Edge Functions: draw, TDS, Razorpay,    │
             │    Mux & WhatsApp webhooks               │
             │  Mux · LiveKit · Razorpay · MSG91        │
             └──────────────▲───────────────────────────┘
                            │  HTTPS + WSS (best-effort)
                            │  ↑↓ event-log replication, idempotent
                            │
          ┌─────────────────┴────────────────────────────┐
          │             VENUE EDGE-PLANE                 │
          │  ┌────────────────────────────────────────┐  │
          │  │  Hub Sync Server  (1 box per venue)    │  │
          │  │  - Postgres (or SQLite-ws)             │  │
          │  │  - Append-only event log               │  │
          │  │  - mDNS discovery, LAN WebSocket bus   │  │
          │  │  - Local web app served at hub.local   │  │
          │  └────────────────────────────────────────┘  │
          │     ▲          ▲          ▲          ▲       │
          │     │ LAN-WS   │          │          │       │
          │  ┌──┴───┐  ┌───┴────┐  ┌──┴───┐  ┌───┴────┐  │
          │  │Hub:  │  │Hub:    │  │Hub:  │  │Hub:    │  │
          │  │M-80  │  │W-60    │  │J-18  │  │Para    │  │
          │  │PWA   │  │PWA     │  │PWA   │  │PWA     │  │
          │  └──┬───┘  └───┬────┘  └──┬───┘  └───┬────┘  │
          │     │ table cam, side-ref tablet, MC overlay │
          │     │ each browses to http://hub.local       │
          └─────┴──────────┴──────────┴──────────┴───────┘
                                │
                  Spectator devices on stadium Wi-Fi also
                  point at hub.local for sub-second scores
```

**Why this stack** (research `05-tech-arch.json`):
- Supabase Realtime — 6 ms median, 28 ms p95 → ✓ for live scoring **when WAN is up**. The hub mesh handles the rest.
- Mux instant-clip — sub-1-second clip creation → ✓ for VAR (degrades to local hub recording offline; uploaded later).
- LiveKit — 1.5–2.5 s voice → acceptable for official comms; LAN-WebRTC fallback for outages.
- RazorpayX Bulk Payouts — UPI/IMPS/NEFT, CSV upload → ✓ for prize money.

**Offline strategy** — see §12 in full. TL;DR: every hub is a self-contained
local server. The cloud is treated as an *eventually-consistent* downstream,
not the source of truth, during live day.

---

## 8. Aesthetic Direction (Frontend)

Following [frontend-design/SKILL.md](frontend-design/SKILL.md): bold, intentional, sport-grade.

**Direction: "Brutalist arena scoreboard meets editorial sports magazine"**

- **Type**: Display — `Editorial New` or `PP Neue Machina` (sharp, mechanical). Body — `Inter Tight` or `Söhne` only as accent; primary body `General Sans`. Tamil — `Catamaran`. Numerals — tabular, oversized.
- **Palette**: Bone-white `#F4EFE6` background, ink-black `#0B0B0C`, blood-red accent `#E5132A` (arm wrestling = blood, sweat — own it), one electric-yellow `#F5E663` for live indicators.
- **Layout**: Asymmetric grids, oversized weight-class numerals, ticker-tape match-results bar, scoreboard cards with hard borders.
- **Motion**: Aggressive slam-cut transitions on score change. Number flip animation on pin. Subtle CRT scanline overlay only on `/live` view.
- **Dark mode**: deep ink with bone accents — used for venue-side referee tablets.

---

## 9. Build Plan — 4 Milestones

### M0 — Skeleton (this session, "first draft")
- Next.js 15 + TypeScript + Tailwind v4 + Supabase client.
- Public landing page (aesthetic hero, philosophy, three CTAs).
- Supabase schema migration v1: `organizations, events, athletes, registrations, weight_classes, rule_profiles`.
- Auth (email magic link).
- `/app/events` list + `/app/events/new` create form.
- Public `/e/<slug>` event page (read from DB).

### M1 — Registration → Weigh-in → Draw (4 weeks of work)
- Athlete registration flow with Razorpay Checkout.
- KYC (PAN/Aadhaar) capture.
- Weigh-in app with photo evidence.
- Bracket generator (double-elim, single-elim, round-robin) — pure TS module, unit-tested per [tdd/SKILL.md](tdd/SKILL.md).

### M2 — Live Day Core (the moat)
- **Category Hub server** (`apps/hub-server`): Node + SQLite WAL + ed25519 signing + append-only `event_log` + LAN WebSocket bus.
- Hub UI: server-rendered HTML over WebSocket, < 200 KB JS, runs on Core-i3 / 4 GB.
- Multi-hub mDNS discovery + LAN gossip + cloud bridge (venue sync server).
- Per-category dashboards: *call next pair*, *log result*, *advance bracket*.
- Side-ref tablet (foul tap) over the same LAN bus.
- Public spectator app per-category live view (LAN direct on stadium Wi-Fi, cloud mirror remote).
- Mux integration for stream + instant-clip (cloud) + local 60-s rolling video buffer (hub) when Mux is unreachable.
- Third-referee VAR console (LAN-attached or cloud).
- Protest workflow (raise → fee debit → review → verdict) — fee debit queues offline, settles when WAN returns.
- LiveKit push-to-talk **with LAN-WebRTC fallback**.
- Crash/power-cut drill: kill -9 a hub mid-match, verify zero data loss after restart.

### M3 — Payouts, Archive, Federation
- RazorpayX bulk payouts + §194B TDS automation.
- Form 16A / payslip PDF generation.
- Match archive + highlight reel auto-cut.
- Federation ranking ledger + sanctioning portal.
- Public REST API.

### M4 — Scale & Polish
- Multi-language (Tamil, Hindi, Telugu, Marathi).
- Native iOS/Android wrappers (Capacitor) for venue use.
- White-label for federations.
- Anti-doping integration (NADA).
- Insurance partnership (Bajaj Finserv Sports cover).

---

## 11. Multi-Hub Operating Model (the live-day backbone)

A national or even district event runs **5–12 weight categories in parallel**
across **2–8 physical tables**. A **Category Hub** is software that owns
one or more categories and one *or several* of those tables. In practice:

- **Small district event** — 1 hub, 1 table, all categories sequenced.
- **State championship** — 1 hub controlling **2–4 adjacent tables** (one
  controller laptop, one operator, scanning winners as they come).
- **Nationals / pro event** — multiple hubs, each owning 1–2 tables and
  a small set of categories, gossiping over the venue LAN.

The hub is software, not hardware. A hub typically maps to a laptop plus
a 32–40" external screen / LED feed at its table(s). One operator
realistically scans for up to 4 short-bout tables; beyond that we
recommend a second hub for sanity, not for technical limits.

### 11.1 What a Hub owns

| Concern | Owned by Hub | Owned by Cloud |
|---|---|---|
| Bracket state for its category | ✅ source of truth | mirror |
| Calling athletes to the table | ✅ | — |
| Recording match results | ✅ append-only | replicated |
| Foul ledger | ✅ | replicated |
| Protest queue for its matches | ✅ raises, holds | mirror + analytics |
| Video clip buffer (last 60 s) | ✅ local disk | uploaded async |
| Spectator score push to LAN | ✅ | — |
| Cross-category seeding / draws | — | ✅ |
| Payouts / KYC / sponsor invoices | — | ✅ |

A hub *cannot* mutate another hub's category. The cloud is the only place that
can re-balance categories across hubs (e.g. "Hub-3 finished its semis early —
move the Para-arm final to Hub-3"). Re-assignment is a single signed event
that both hubs replay.

### 11.2 Hub roles & devices on a hub's LAN

```
Hub Controller laptop  →  serves http://hub-1.local on LAN
        │
        ├─ USB QR/barcode scanner   (the controller holds it; one beep = result)
        ├─ USB label printer        (ID cards at weigh-in counter)
        ├─ USB webcam              (live photo at weigh-in / scale photo)
        ├─ Big-screen / LED per table  (now-on-table view, full-screen, read-only)
        ├─ MC tablet               (mirrors hub's now-on-table; announce script)
        ├─ Side-ref tablet         (optional — tap fouls)
        └─ Camera box per table     (USB or IP cam, 60-s rolling buffer for VAR)
```

A single hub can drive multiple tables — each table just needs its own
big screen and (optional) camera. The hub UI shows one row per table; the
operator's scanner gun is shared and **armed per table** by tapping that
table's row before scanning the winning ID card.

- Hubs discover each other and the central **Venue Sync Server** via mDNS
  (`_dinohub._tcp.local`).
- A WebSocket bus on the venue LAN replicates the event-log between hubs
  every match. Cloud is one more subscriber to that bus.
- One-machine venues are supported: the laptop is **both** the venue sync
  server **and** the only hub, no separate box needed.
- Each hub keeps a complete copy of the *cross-hub schedule + athlete
  roster* so the show can continue even if a sibling hub goes dark.

### 11.4 Per-category dashboards

Every category gets its own URL on the public spectator app — e.g.
`/e/<slug>/c/senior-men-80kg` — backed live by the owning hub. Spectators on
stadium Wi-Fi resolve `hub-m80.local` directly for sub-second updates;
remote viewers are served via the cloud mirror.

### 11.5 Hub lifecycle

A hub passes through six explicit states. Every transition is itself a
signed event in `event_log` so we can replay "what hub did what, when".

```
   provisioned  ──enroll──▶  enrolled  ──assign──▶  online
        │                                       │   ▲
        │                              degrade  │   │ recover
        │                                       ▼   │
        │                                   degraded
        │                                       │
        │                              handoff  │
        │                                       ▼
        └──────────────────────────────────────▶ retired
```

1. **Provisioned** — USB stick is flashed; on first boot the hub generates an
   ed25519 keypair locally, prints the **public-key fingerprint + 6-digit
   pairing PIN** to its console screen.
2. **Enrolled** — organiser opens cloud admin, scans the hub's QR (contains
   pubkey + PIN), assigns it a code (`hub-m80`) and a venue. Cloud signs an
   *enrolment certificate* and sends it back over the LAN. Now the hub has
   an identity the rest of the federation trusts.
3. **Online** — hub has at least one active `category_assignment`, is
   publishing heartbeats every 5 s, and is visible on the venue LAN.
4. **Degraded** — missed > 3 heartbeats *or* WAN gone *or* WS-bus partition.
   Hub keeps operating its category locally; cloud shows a yellow badge.
5. **Handoff** — organiser explicitly transfers a category to a sibling hub.
   The leaving hub emits `category.released`, the receiving hub emits
   `category.adopted`, the cloud emits the matching mandate. All three are
   required for the new ownership to be valid — no silent steal.
6. **Retired** — hub is decommissioned; its keypair is revoked but its past
   events remain forever valid (signature verifies against the historical
   pubkey stored in `hubs.public_key`).

### 11.6 Failure playbook (the things that *will* go wrong)

| Failure | Detection | Recovery (no operator action needed) | Recovery (operator action) |
|---|---|---|---|
| Hub laptop crashes mid-match | Heartbeat gap; siblings notice in 15 s | LAN gossip preserved by siblings; cloud holds projection | Reboot hub → it replays its own log + pulls missing events from a sibling → back online in < 60 s |
| Hub laptop **physically dies** (drink spilled) | Heartbeat permanently gone | Sibling hubs hold the full event log for that category | Plug in spare USB stick on a fresh laptop, run `hub-server restore --from=sibling` — inherits identity via signed cloud handoff |
| LAN switch dies | All hubs go isolated simultaneously | Each hub keeps running its own category in pure-local mode | Bring switch back; hubs auto-reconcile via `since=<last-hash>` |
| Two hubs accidentally configured to own same category | Cloud rejects the second `category.adopted` event (unique active assignment); LAN bus surfaces a red banner | — | Organiser picks one, runs explicit handoff |
| Head ref says "red wins", scribe taps BLUE | Not a system failure | — | Use 5 s undo, or emit `match.result.reverted` (logged forever) followed by correct result |
| Power cut on whole venue | Heartbeats die | UPS on the venue sync server keeps central log alive 15 min; hubs running on laptop battery survive | When power returns, hubs reconnect, missing events re-gossiped from anyone who saw them |
| Cloud (Supabase) outage | WAN push queue grows on venue sync server | Live show is unaffected — cloud is downstream | Queue drains when Supabase recovers; idempotent IDs guarantee no duplicates |
| Single hub develops bad RAM, signs a corrupt event | Hash-chain verifier on receiving sibling/cloud rejects it | Bad event is *not* accepted; chain stops at last good hash | Hub is forced to `degraded`; ops takes it offline; events from before the corruption remain valid |

### 11.7 Hub security & lock-down

The hub laptop is a **kiosk**, not a general-purpose computer.

- **Auto-login** to the `hub-server` PWA at boot — the controller never sees
  a desktop, browser address bar, or file manager.
- **Operator login** is a 6-digit PIN tied to a profile in the cloud. PINs
  rotate per event. A controller can only operate *their assigned hub* —
  the same PIN on a different hub fails.
- **Role gating on the hub itself**: scribe can record results, but only the
  hub's *Hub Lead* can release a category, force-end a match, or void a
  result. Every privileged action is double-confirmed.
- **Audit overlay**: pressing a hidden corner reveals the last 20 events on
  this hub with actor + signature — useful when a head-ref disputes "who
  entered that?".
- **No outbound Internet** required during a match. The only cloud traffic
  is the venue sync server's batched push, on a separate NIC if possible.
- **USB ports disabled** in the hub OS image except for the camera and the
  ID-card printer (allow-list by USB vendor/product ID).

### 11.8 Simplicity & reliability principles (the operator's contract)

Every previous attempt at this fell over because operators were asked to
think under pressure. We commit to these rules so they don't have to:

1. **No typing on competition day.** Names, categories, and weight classes
   are pre-loaded by registration & weigh-in. The only inputs at a table
   are scans, taps, and the head-ref's voice.
2. **Three taps maximum per match.** Arm scanner → scan winner ID → (optional
   undo within 5 s). Anything more is a bug.
3. **One screen per role.** Controllers, MCs, and side-refs each have one
   focused screen — no tabs, no menus, no settings dialogs visible during
   live mode. Settings are unlocked by a long-press hidden gesture.
4. **Page reload is always safe.** Every hub UI restores to the same
   row/state in < 1 s from local SQLite. Crashes during weigh-in or
   live day cost zero data and < 5 s of operator time.
5. **No drop-downs in critical paths.** Drop-downs are how mistakes happen
   under pressure. Critical actions are large rectangular buttons with
   the *single* default action; alternatives live behind a long-press.
6. **Defaults that work for the median operator.** Right hand, double-elim,
   pin verdict, English+Tamil. Changing them is a one-time setup, not a
   per-match decision.
7. **Cheap commodity hardware only.** Any ₹20k laptop, any ₹1.5k USB QR
   scanner, any ₹1k USB label printer, any ₹1k USB webcam. No proprietary
   peripheral, no Bluetooth, no Apple-only ports.
8. **The system is never the reason a match is delayed.** If the hub
   crashes, the head-ref keeps refereeing; the scribe records the
   sequence on paper for the 60-second restart window; the hub replays
   the paper into the log on recovery.

---

## 12. Offline-First, Tamper-Proof Data (the durability spine)

**Hard requirement, owner-stated:** *the isolated hub or computer at any
point — registration, weigh-in, ID printing, competition day — must not be
allowed to tamper or lose data unless the device itself is damaged or
unrecoverable.*

### 12.1 Local-first stack on each hub

- **Storage**: SQLite (WAL mode) for the event log + a derived state DB.
  No browser-only IndexedDB for authoritative data — too easy to wipe.
- **Process**: a tiny Node service (`hub-server`, < 30 MB RAM) serves the
  PWA on `http://hub-m80.local` and the WebSocket bus.
- **Boots from a USB stick**: signed Linux image OR a portable Windows
  install. Copy the stick → identical hub. Old hardware (Core i3, 4 GB
  RAM, 2010-era laptops) is the explicit performance target.

### 12.2 Append-only event log

Every state change anywhere in the system is one row in `event_log`:

```
event_log(
  id          uuid,           -- client-generated, ULID-style
  hub_id      uuid,           -- which hub originated
  device_id   uuid,           -- which physical device
  actor_id    uuid,           -- which logged-in user
  topic       text,           -- 'match.result' | 'weigh_in.recorded' | ...
  payload     jsonb,
  client_ts   timestamptz,    -- monotonic on device (HLC clock)
  prev_hash   bytea,          -- hash chain — last 32 bytes of prev row
  hash        bytea,          -- sha256(prev_hash || canonical(payload))
  signature   bytea           -- ed25519, hub key + actor key
)
```

Rules:
- **Append-only** — DB-level: `revoke update,delete on event_log` for
  every role except `auditor` (cloud-side only, with full audit trail).
- **Hash chain** — any tamper breaks the chain; verifiable on every read.
- **Per-device key** — each hub has an ed25519 keypair generated on first
  boot, public key registered with cloud. Every event is signed.
- **Hybrid Logical Clock** — `client_ts` always increases monotonically per
  device, even if the OS clock is bad (common on old laptops with dead
  CMOS batteries).

Derived tables (`matches`, `brackets`, `registrations`, etc.) are *projections*
of the event log. Lose a derived row → re-project from the log. Lose the
log → only physical disk failure can do that.

#### 12.2.1 Event topic taxonomy (v1)

Flat dotted strings, namespace by stage. Adding a topic is a code change
(reviewed) so the taxonomy stays intentional.

| Topic | Emitted by | Payload (essentials) |
|---|---|---|
| `event.created` | cloud | event metadata |
| `event.published` | cloud | publish flags |
| `category.opened` / `.closed` | cloud | category_id, bracket_format |
| `category.adopted` / `.released` | hub | category_id, hub_id, mandate_id |
| `registration.submitted` | cloud / hub | athlete_id, division, weight_class, source ('state'/'self'/'on_spot') |
| `registration.approved` / `.rejected` | organiser / federation | reason |
| `registration.reassigned` | weigh-in chief (signed) | from_athlete?, to_athlete, target_category, reason, override_note? |
| `payment.received` | cloud (Razorpay webhook projection) | payment_id, amount |
| `weigh_in.recorded` | hub (weigh-in tablet) | athlete_id, kg, scale_photo_hash, live_photo_hash |
| `weigh_in.disputed` / `.reweighed` | hub | reason |
| `id_card.printed` | hub | athlete_id, badge_qr_signature |
| `bracket.generated` | hub | category_id, seedings, draw_seed |
| `match.scheduled` | hub | match_id, red, blue, table_id |
| `match.called` | hub | match_id, table_id (now-on-table) |
| `match.started` | hub | match_id, head_ref_id |
| `match.fouled` | hub | match_id, side (red/blue), foul_code |
| `match.warned` | hub | match_id, side, reason |
| `match.result` | hub | match_id, winner_qr, table_id, mode (pin/foulout/walkover) |
| `match.result.reverted` | hub | match_id, reverts_event_id, reason |
| `protest.raised` | hub | match_id, by_team, fee_paid |
| `protest.evidence_added` | hub / cloud | clip_id, note |
| `protest.ruled` | hub (third ref) | verdict, fee_returned |
| `payout.proposed` / `.executed` | cloud | athlete_id, amount, utr |

All payloads are validated against a JSON schema bundled with the hub
binary; an unknown topic or schema-fail event is **rejected at ingest**
— it never reaches the log.

#### 12.2.2 Worked example: one match result

```jsonc
// Row about to be appended on hub-m80
{
  "id":         "01JBM9X4TZ-7B2K-V8N1-A4P9-Q6R0S2T8U1",
  "hub_id":     "...m80",
  "device_id":  "...controller-laptop",
  "actor_id":   "...scribe-ravi",
  "topic":      "match.result",
  "payload":    {
    "match_id": "...sf2-m80",
    "winner":   "red",
    "mode":     "pin",
    "duration_ms": 4830,
    "head_ref_id": "...arul",
    "announced_at_client": "2026-04-21T14:32:11.220+05:30"
  },
  "client_ts":  "2026-04-21T14:32:11.224+05:30",
  "prev_hash":  <32 bytes of previous row's hash on hub-m80>,
  "hash":       sha256( prev_hash || canonical_json(payload) || client_ts ),
  "signature":  ed25519_sign(hub_key, hash) || ed25519_sign(actor_key, hash)
}
```

Verifier (any node) recomputes `hash` from canonical JSON, compares to
the stored value, then verifies both signatures against the hub's and
actor's published public keys at `client_ts`. Any mismatch → log is
treated as forked; downstream nodes refuse to project past the break.

The chain is **per-hub** (not global) so two hubs writing in parallel
don't serialise on a single chain head — critical for performance and
partition tolerance. The cloud merges the per-hub chains into the global
timeline by `(hub_id, hash)`.

#### 12.2.3 Canonical JSON

We use [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) for the
canonicalisation step before hashing: keys sorted, no insignificant
whitespace, numbers in shortest round-trip form. This guarantees the
same payload hashes identically on Node, Postgres (`pgcrypto`), and the
auditor CLI — a non-trivial subtlety we get wrong if we wing it.

### 12.3 Replication & conflict resolution

- **Within a venue (LAN)**: hubs gossip new events to peers via WebSocket
  every 1 s; full-resync on reconnect via `since=<last-hash>`.
- **Venue ⇄ cloud**: the venue sync server is the only thing that talks to
  Supabase. Pushes are batched, idempotent (`event_log.id` is the key),
  and resumable. A 6-hour WAN outage is a non-event: queue grows on disk,
  drains when WAN returns.
- **Conflicts**: the event log is *partition-tolerant by design* —
  ownership is enforced upstream (Hub-X owns category Y, only Hub-X may
  emit `match.result` for category Y). Cross-hub events (e.g. an athlete
  moved between divisions) require a signed cloud-issued mandate.
- **Read-after-write guarantee**: scoped to *the originating hub's LAN*.
  Cross-hub and cloud reads are eventually consistent.

#### 12.3.1 Wire protocol (LAN gossip)

Discovery: every hub advertises mDNS service `_dinohub._tcp.local` with
TXT records `event=<id>`, `hub=<code>`, `pk=<pubkey-fpr>`, `head=<last-hash>`.
A hub that sees a sibling with a `head` it doesn't have opens a WS pull.

WebSocket framing (one JSON object per frame):

```jsonc
// Pull request
{ "op": "pull", "hub": "hub-m80", "since": "<last-hash-on-receiver>" }

// Push frame (server response, repeated until caught up)
{ "op": "events", "hub": "hub-m80", "rows": [ /* event_log rows */ ] }

// Catch-up complete
{ "op": "caught_up", "hub": "hub-m80", "head": "<latest-hash>" }

// Live broadcast (to all subscribed peers, after every successful append)
{ "op": "append", "hub": "hub-m80", "row": { /* one event_log row */ } }

// Heartbeat (every 5 s)
{ "op": "hb", "hub": "hub-m80", "head": "<latest-hash>", "ts": "..." }
```

Idempotency: every receiver does `INSERT ... ON CONFLICT (id) DO NOTHING`.
Replaying the same frame N times is safe.

Ordering: receivers buffer rows whose `prev_hash` they don't yet have, up
to a 1000-row window, then ask for a targeted backfill. We never apply
out of chain order — the projection layer would otherwise emit phantom
states.

#### 12.3.2 Wire protocol (cloud bridge)

The venue sync server batches up to 500 rows or 2 s, whichever first,
and POSTs to a single Supabase Edge Function (`/ingest`). The function:

1. Verifies each row's signature against `hubs.public_key` valid-at
   `client_ts`.
2. Verifies hash chain continuity per `hub_id`.
3. Verifies the emitter is allowed to emit that topic for that
   `category_id` (ownership rule).
4. Inserts with `ON CONFLICT (id) DO NOTHING`.
5. Returns `{ accepted: [...ids], rejected: [{id, reason}, ...] }`.

A rejected row halts the cloud-side projection at its predecessor and
raises a forensic alert; the hub stays operational on LAN.

### 12.4 Tamper resistance

| Attack | Defence |
|---|---|
| Operator deletes a row to fix a bad call | DB grants prevent it; the only way to "undo" is an explicit `*.reverted` event that itself is logged and signed |
| Operator edits the on-disk SQLite file | Hash chain validation fails on next sync; cloud rejects the rest of the batch and flags the hub for forensics |
| Operator rolls back the OS clock | HLC ensures `client_ts` never goes backwards within a device |
| Operator copies an old SQLite file from a backup to "undo" recent events | The newer events still exist on siblings + cloud; on next gossip the missing rows return; the hub's chain head no longer matches and the hub is marked `degraded` |
| Operator swaps the hub's keypair | New pubkey doesn't match the enrolment cert; cloud rejects everything signed with it |
| Two operators race to enter the same result | Only one append wins (per-hub chain serialises); the loser's UI shows the winning value and prompts to confirm or revert |
| Hub is replaced mid-event | New hub gets event log via LAN gossip from siblings; identity transferred by signed cloud event |
| Power cut at the moment of a result | SQLite WAL + `fsync` per critical event = at-most-one-event loss, and the operator simply re-enters that one match |
| Malicious LAN peer spams forged events | Signature check fails (no matching enrolled pubkey); peer is dropped from the gossip mesh |

### 12.5 Backup & disaster recovery (the 3-copies rule)

At any moment during live day, every event exists in **at least three
places** before we tell the operator "saved":

1. The originating hub's local SQLite (WAL fsynced).
2. The venue sync server's mirror (LAN push, < 1 s).
3. At least one sibling hub's mirror (LAN gossip, < 1 s).

WAN/cloud is a *fourth* copy, not relied upon during the show.

**Snapshots**: every 5 minutes the venue sync server writes a compressed
snapshot of the full event log to a USB drive plugged into it. A 12-hour
event fits comfortably in 200 MB.

**Rebuild from zero**: given any one surviving copy of the event log we
can fully rebuild every derived table on every hub and on the cloud by
re-running the projection. There is no other source of truth to lose.

**Disaster scenarios:**

| Scenario | Recovery |
|---|---|
| One hub's disk dies | Restore log from venue sync server or any sibling; keypair re-enrolled with a signed handoff |
| Venue sync server dies | Promote any hub to also act as venue sync server; gossip mesh continues |
| Both venue sync server *and* a hub die simultaneously | Surviving hubs still hold the log via gossip mirror; restore both from a sibling |
| Whole venue burns down | Cloud holds everything pushed up to the moment WAN went down; the gap (if any) is the only loss and it's bounded by the WAN-outage window |
| Cloud database dropped | Re-ingest from the venue snapshots (USB) of every event we ran |

### 12.6 Performance budget for old hardware

Target device: **Intel Core i3, 4 GB RAM, integrated graphics, 1366×768,
Windows 10 / Ubuntu 20.04, 2.4 GHz Wi-Fi only**.

- Hub UI bundle: **< 200 KB JS gzipped**, no client-side React tree-shake
  required. We will likely ship a *lighter* hub UI than the cloud app:
  HTMX-style server-rendered HTML over WebSocket, with a tiny vanilla-TS
  layer for the big touch targets.
- First-paint on target hardware: **< 1.5 s**.
- Result-entry → all spectator screens updated: **< 500 ms p95 on LAN**.
- 60 fps animation budget is dropped — large, motion-sparse type instead.
- All assets are pre-bundled into the hub server binary; **no runtime CDN
  fetches** during live day.

### 12.7 Other tamper-sensitive flows (not just live day)

- **Registration & weigh-in**: same event-log discipline. Each weigh-in
  produces an event with the scale photo as a content-addressed blob; the
  blob hash is in the event payload. Removing the photo file invalidates
  the event.
- **ID-card printing**: each printed badge has a QR pointing to the event
  ID + signature. Re-prints are themselves logged.
- **Audit export**: at any time the federation can export the full signed
  event log as JSONL → independently verifiable with our public key.

### 12.8 Auditor verification CLI

We ship a tiny standalone binary `dino-verify` (Go, single executable, ~6 MB,
no deps) for federations, sponsors, and aggrieved athletes:

```
$ dino-verify ./event-2026-04-21.jsonl --keys=https://keys.dino.app
  rows:           14,832
  hubs seen:      6   (m80, w60, j18, m_open, w_open, para)
  chain ok:       ✓  (per hub)
  signatures ok:  ✓  (14,832 / 14,832)
  topic schemas:  ✓
  ownership rule: ✓  (no foreign emissions)
  monotonic ts:   ✓  (HLC per device)
  result:         VALID
```

A single byte changed anywhere in the export → the affected chain breaks
and the tool reports the exact row, hub, and topic. This is what makes
"tamper-proof" something we can actually hand to a federation lawyer,
not just a marketing word.

---

## 13. Feature parity with the TNAWA incumbent site

The Tamil Nadu Arm Wrestling Association currently runs registrations on
<https://armwrestling-registration.vercel.app/>. A full scrape and
reverse-engineering report is in
[research/11-tnaw-scraper-report.md](research/11-tnaw-scraper-report.md).
We must match this surface before we can credibly offer to replace it.

### 13.1 Parity checklist (must ship in M0 → early M1)

| # | TNAWA feature | Where it lands in our plan |
|---|---|---|
| 1 | Athlete entry form (initial, name, team/district, DOB, mobile, aadhaar, gender, multi-age-category with per-category hand, weight, photo, amounts) | M0 — `web/src/app/register/page.tsx`, server action + `registrations` table (§3.3) |
| 2 | 38-district TN dropdown (verbatim list, alphabetical) | M0 — seed in `supabase/migrations/000x_tn_districts.sql` |
| 3 | 8-tier age-category pill picker (Sub Junior … Super Senior Grand Master) | M0 — `rule_profile` seed for IAFF/TNAWA |
| 4 | Per-age-category hand selection (R / L / Both) | M0 — many-to-many: `registration_entries(registration_id, age_category, hand)` |
| 5 | Webcam photo capture with Vercel Blob-style object storage | M0 — Supabase Storage `athlete-photos` bucket |
| 6 | "Registered Players" live list with search, edit, delete, auto-refresh | M0 — Supabase Realtime subscription on `registrations` |
| 7 | Superadmin-gated user creation (re-auth before issuing credential) | M0 — step-up auth via Supabase `verifyOtp` + `password_verify` edge function |
| 8 | Operator roles with free-text `rank` label | M0 — `profiles.rank` (cosmetic) + `profiles.role` (enum, gating) |
| 9 | Nominal list export — one xlsx per district | M0 — `/api/export/nominal` → zip |
| 10 | Category list export — one xlsx per (age × gender × weight-class × hand) | M0 — `/api/export/category` → zip |
| 11 | ID card PDF export (photo, chest no., district, age cat.) | M1 — `/api/export/id-cards` → PDF via `@react-pdf/renderer` |
| 12 | Pending dues xlsx export | M0 — `/api/export/pending-dues` |
| 13 | Per-event chest-number sequence starting at 1001 | M0 — `registrations.chest_number` assigned by DB sequence scoped to `event_id` |

### 13.2 Things we deliberately do **not** replicate

From the scrape report §10:

- Username wrapped in `_…_` underscores to authenticate — that is a stuck
  migration artefact. We use email / phone + password, not a mangled
  handle.
- `X-Username` header required alongside a valid auth cookie — this is a
  privilege-escalation footgun. We use a proper session + RLS.
- `window.prompt()` for event editing — we ship a modal.
- Events-as-strings — we ship a real `events` table from day one (§3.1).
- Free-text aadhaar without Verhoeff check — we validate.
- No CSRF, no audit log on delete — we sign every mutation (§12).

### 13.3 TNAWA data-import path

Existing TNAWA rows can be pulled via `GET /api/athletes` (with
`X-Username`). We ship a one-shot CLI `dino-import tnaw --url … --user …`
that:

1. Reads every athlete row.
2. Fans them out into one `registration` + N `registration_entries` (one
   per age category, since TNAWA stores them denormalised).
3. Downloads each `photoUrl` and re-uploads to our Supabase bucket.
4. Seeds a single synthetic `event` from the free-text `eventName`.
5. Writes a `registration.imported` event per row into `event_log`
   (§12.2.1) so the provenance survives.

Target: a TNAWA user can be fully migrated in under ten minutes for an
event with ~1,000 athletes.

---

## 14. Para arm wrestling (explicit category support)

The TNAWA incumbent has no para support — gender is binary, there is no
classification, and para athletes are either forced into able-bodied
brackets or excluded. We ship full para categories from M0. Research:
[research/09-para-armwrestling.json](research/09-para-armwrestling.json).

### 14.1 WAF / IFAA para classifications (what we model)

Para arm wrestling under WAF (*Para* was added to the WAF rulebook as a
formal division in 2018, contested at Worlds since 2019) is structured
on **functional arm capability**, not impairment site. The classes are:

| Code | Name | Who competes |
|---|---|---|
| `PAW-STD` | Standing | Ambulant athletes with lower-limb impairment only |
| `PAW-WC`  | Wheelchair / Seated | Athletes who compete seated, on a regulation WAF table height |
| `PAW-ARM` | Upper-limb amputee | Competes with the unaffected arm; opposite table configuration |
| `PAW-VI`  | Vision-impaired | Sighted guide for table positioning; same rules otherwise |
| `PAW-LES` | Les Autres | Residual category for combinations not covered above |

Each para class runs its **own weight divisions**, using the same
WAF/IAFF weight ladder as able-bodied (Men and Women). We do **not**
merge para athletes into able-bodied brackets — they get parallel
brackets, scored on the same hub.

### 14.2 Data-model delta

Our `registrations` table already carries `division ∈ {able, para}` per
the existing §3 outline. We extend with:

```
para_classification_code   text   -- 'PAW-STD' | 'PAW-WC' | 'PAW-ARM' | 'PAW-VI' | 'PAW-LES' | NULL
para_side                  text   -- 'Right-arm competitor' | 'Left-arm competitor' — mandatory for PAW-ARM
classifier_signoff         uuid   -- references profiles.id (must have role='para_classifier')
classification_expires_on  date   -- WAF classifications are re-verified every 24 months
```

Additional form fields on `/register`:

- Division radio: `Able-bodied` / `Para` — drives conditional UI.
- If Para: class dropdown, side (for amputee only), classification
  certificate upload (PDF/JPEG), classifier's name + WAF ID.

### 14.3 Rules engine extensions

The `rule_profile` row for a para category adds:

- `table_mode`: `STD` (regulation) | `WC-SEATED` (chair braced against
  table, strap permitted) | `AMP-MIRROR` (single-side table config).
- `foul_adjustments`:
  - Elbow-lift foul is replaced by strap-slip warning on `WC-SEATED`.
  - `PAW-ARM` disables the dangerous-position foul (the opposite hand
    has nothing to hold onto by definition).
- `weigh_in_mode`: `PAW-WC` uses chair-inclusive weighing (weigh chair
  empty first, subtract at athlete weigh-in). Tested on our weigh-in
  flow in §3.4.

### 14.4 Bracket & fixture

Para categories use the **same fixture engine** as able-bodied (see §15
for double-elim), with two differences baked in:

- A minimum of **three athletes** in a para class generates a
  round-robin instead of a bracket — para fields are small, and a
  3-person "bracket" is statistically noise.
- Para classification sign-off is required *before* the draw. An
  unclassified para athlete blocks bracket generation with a clear error
  ("Athlete A. Kumar is missing PAW-WC classifier sign-off. Resolve or
  withdraw.").

### 14.5 Para-specific operational surfaces

- **Accessibility-mode welcome desk**: QR-card is printed at A5 (not A7)
  for low-vision athletes; audio announcement via the MC surface when a
  `PAW-VI` athlete's bout is called.
- **Physio-on-call flag** per para registration that the medical staff
  surface (§2, persona 10) can see.

### 14.6 Para-specific rollup in exports

The category-list xlsx (§13.1 row 10) gains a `Division` column and the
filename becomes `<Division> <AgeCat> <Gender> <Weight> KG <Hand> Hand.xlsx`
(e.g., `Para-WC Senior Men 80 KG Right Hand.xlsx`). We keep a compat flag
`--tnaw-legacy` on the export CLI that drops the division prefix so a
TNAWA user accustomed to the old filenames isn't surprised.

---

## 15. Double-elimination fixtures (first-class support)

The TNAWA site has no fixture engine at all. WAF nationals and the Pro
Panja League both use **double-elimination with grand-final reset** — an
athlete has to lose twice to be eliminated. We ship double-elim as the
default format from M0, alongside single-elim and round-robin.
Research: [research/10-double-elim-algo.json](research/10-double-elim-algo.json).

### 15.1 What "double-elim with reset" actually means

- Winners bracket (WB): standard single-elim.
- Losers bracket (LB): WB losers drop in at structured points.
- Grand Final: WB champion vs. LB champion.
  - If the WB champion wins → tournament ends.
  - If the LB champion wins → **bracket reset**: a second grand final is
    played, because the WB champion has not yet lost twice. Winner of
    the second match is champion. WAF and PPL both use this rule.

### 15.2 Fixture algorithm (deterministic, testable)

Inputs: a seeded list of `N` athletes (from weigh-in ranking or prior-
tournament points).

1. **Pad to next power of two**: the smallest `M = 2^k ≥ N`. Introduce
   `M - N` **BYE** entries, placed so that top seeds face BYEs first.
2. **Seed-pair the winners bracket** using the standard 1-vs-M,
   2-vs-(M-1) anti-seeding so the two top seeds can only meet in the
   WB final.
3. **Generate losers-bracket drop-in points** per the canonical DE
   structure (size `M-1` matches on the winners side, `M-2` matches on
   the losers side; drop-in rounds alternate so that no athlete plays
   the same opponent twice in LB before the grand final unless
   unavoidable with small N).
4. **Emit match rows** with:
   - `round_code`: `WB-R1`, `WB-R2`, …, `WB-F`, `LB-R1`, …, `LB-F`,
     `GF-1`, `GF-2` (reset).
   - `depends_on_match_ids`: each match lists the (up to two) matches
     that must complete before it is schedulable; the reset match lists
     only `GF-1` **and** a boolean `only_if_lb_wins`.
5. **Persist the full fixture graph before the event starts.** BYEs
   auto-advance on generation — we do not lazily create matches as we
   go, because that makes it impossible to show athletes "you play at
   ~11:15 on Table 2" when the draw is published the night before.

The algorithm is a pure function from `(seeded_list, N_tables,
table_min_gap_per_athlete_minutes)` to a fixture graph; we unit-test it
with the reference tables from the WAF technical rule book and known
PPL season-2 brackets.

### 15.3 Data-model delta

Extending the tables outlined in §12.2.1:

```
categories(
  …,
  bracket_format text not null default 'DOUBLE_ELIM',
      -- 'SINGLE_ELIM' | 'DOUBLE_ELIM' | 'ROUND_ROBIN' | 'GROUP_STAGE_KO'
  grand_final_reset bool default true   -- ignored unless DOUBLE_ELIM
)

matches(
  …,
  bracket_side   text,    -- 'WB' | 'LB' | 'GF'
  round_code     text,    -- e.g., 'WB-R2', 'LB-R3', 'GF-1', 'GF-2'
  slot_index     int,     -- position within the round
  winner_to_match_id  uuid,
  loser_to_match_id   uuid,
  is_bye         bool default false,
  depends_on     uuid[]   -- for scheduler, not for correctness
)
```

Projection from `event_log` (topics `bracket.generated`,
`match.scheduled`, `match.result`) populates this deterministically.

### 15.4 Scheduler (multi-table within one category hub)

A single category can run across multiple tables (e.g., the 80 kg class
uses two tables at nationals because it has 96 athletes). The scheduler:

- Respects `table_min_gap_per_athlete_minutes` (default 12 min) — a
  winner is not called back before their muscles have had rest, and WAF
  requires at least 10 minutes.
- Prefers the "freshest" WB round over LB when both are ready, so the
  TV product has the strongest matches in prime time.
- Never splits `GF-1` and `GF-2` across tables — the grand final must
  stay on the showcase table even if a neighbouring one is idle.

The scheduler is a **pure function + observer** — it proposes the next
match for each idle table, the hub controller (human) confirms before
`match.called` is logged. We never auto-start a match.

### 15.5 Worked example (16-athlete bracket)

- 16 athletes, 4 tables, double-elim with reset.
- WB: 8 R1 matches, 4 R2, 2 SF, 1 F — 15 WB matches total.
- LB: 14 matches across 7 rounds.
- GF: 1 guaranteed, 1 conditional (reset).
- Total match count: 30 guaranteed + 1 possible = **30 or 31**.
- With four tables and a 12-minute rest buffer the scheduler lands the
  fixture inside ~3 hours elapsed time, assuming 4-minute average match
  clock.

These numbers are used as the default planning heuristic on the event-
setup screen; the organiser sees "approx. 3 h for 80 kg" before they
commit the draw.

### 15.6 Safety rails

- **No silent mid-bracket re-seeding.** Once `bracket.generated` is in
  the event log, any change (withdrawal, reclassification) must be a
  signed `bracket.amended` event with reason text. The UI will not let
  you "just edit" a bracket.
- **Walkover handling** — if an athlete fails the bout-call window (WAF
  30 s), the opponent gets a `match.result mode=walkover`; that flows
  normally through the loser/winner side routing.
- **LB double-loss and GF reset** are asserted as invariants in the
  projection — the projector refuses to emit a final "champion" until
  the two-loss rule is satisfied for everyone except the champion.

---

## 16. Open Questions for You

1. **Hosting**: Vercel (recommended for Next.js 15) vs. self-host on AWS Mumbai (data residency)?
2. **Pilot federation**: Do you have a TN AWA / district contact to be design partner?
3. **Streaming**: Mux is best-in-class but $$ — start with YouTube Live RTMP only?
4. **Brand name**: Keep `dino-arm-tourney` or rename for launch (suggestions: *Panja*, *Pin*, *TableSide*, *Phalanx*)?
5. **Prize-money custodian**: Do we hold funds in escrow (RazorpayX virtual account) or pass-through to organiser?

---

*Next step (M0): scaffolding the Next.js + Supabase first draft.*

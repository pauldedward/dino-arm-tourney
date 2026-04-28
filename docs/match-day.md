# Match-day runbook — TN State Arm Wrestling Championship

This is the on-site ops guide for the weekend. Print it. Tape a copy to the
laptop running the server.

---

## 0. Kit (confirm before leaving)

- Laptop (charged, charger, venue-appropriate adapter)
- Phone hotspot + spare SIM / local mi-fi
- Wired Ethernet cable + portable router (backup)
- Colour printer or bring-to-desk printer + card stock (A4, 300 gsm)
- Scissors / guillotine + lanyards + clips
- USB webcam or spare phone for weigh-in
- Calibrated scale + backup scale
- Tally counter, pens, duct tape, extension strip

---

## 1. Boot the platform (T-60 minutes)

On the laptop:

```powershell
cd D:\personal\dino-arm-tourney\web
npm run build
npm start -- -H 0.0.0.0 -p 3000
```

The service worker (`/sw.js`) auto-registers in production builds. It caches
the app shell, every HTML page volunteers visit, and every static asset, so
those pages keep loading offline. To enable it in dev too, set
`NEXT_PUBLIC_ENABLE_SW=1`.

Note the LAN IP (e.g. `192.168.1.42`). Volunteers' phones connect to the
same Wi-Fi and open `http://192.168.1.42:3000/admin`.

Print a QR code for that URL and tape it to every check-in / weigh-in / desk
station.

### 1.1 Pre-cache all media (critical for flaky venue Wi-Fi)

```powershell
npm run cache:photos -- --event=<event-uuid>
```

That writes every athlete photo, weigh-in photo, logo, banner, and signature
image into `web/public/cached/`. If the venue's Wi-Fi drops, PDF generation
and ID cards still work.

### 1.2 Smoke-test

- `/admin/events` → 200 for a super_admin.
- `/admin/weighin` → loads the registrations grouped Pending / Done.
- `/api/pdf/nominal?event=<id>` → streams a PDF.

---

## 2. Roles & who does what

| Station | Role (DB) | URL |
|---|---|---|
| Payments desk | `accounts` | `/admin/events/<id>/registrations` → Verify |
| Weigh-in | `weigh_in_official` | `/admin/weighin` |
| Brackets / ops | `operator` | `/admin/categories?event=<id>` |
| Print | `operator` | `/admin/print` |
| Super admin | `super_admin` | `/admin/users`, `/admin/audit` |

Invite users from `/admin/users` before the event. Everyone signs in via
Supabase magic link.

---

## 3. Sequence of the day

### 3.1 Check-in + payment (T-120 to T-30 min)
1. Athlete arrives. Accounts desk opens `/admin/events/<id>/registrations`,
   filters `status=pending`, finds them by chest number or name.
2. Accountant verifies UPI screenshot, clicks **Verify payment**.
3. Registration status flips `pending → paid`. Audit row `payment.verify`.

### 3.2 Weigh-in (T-90 to T-15 min)
1. Weigh-in official opens `/admin/weighin` on a phone or tablet.
2. Pending list = athletes who are `paid` but not `weighed_in`.
3. Tap an athlete → point the rear camera at them on the scale → read the
   displayed kg → submit.
4. If the network drops mid-submit, the form **queues the record to
   IndexedDB**. The header pill shows `N queued`. On reconnect it flushes
   automatically.
5. `status` advances to `weighed_in`. Audit row `weighin.record`.

### 3.3 Generate fixtures (T-15 min)
1. Operator opens `/admin/categories?event=<id>`.
2. Clicks **Generate fixtures** (confirm dialog).
3. The API wipes any prior entries/fixtures for this event, re-resolves
   every paid/weighed-in registration into `(division × age_band × weight
   × hand)` entries, seeds by chest number, spreads districts in round 1,
   and inserts a single-elim bracket with top-seed byes.

### 3.4 Print everything (T-10 min)
On `/admin/print`:
- **Nominal Roll** — give to check-in desk.
- **Category Sheet** — give to table referees.
- **Fixtures** — give to MC + pin to wall.
- **ID Cards** — cut, punch, lanyard, hand out.
- **Pending Dues** — for the accounts desk (should be empty by T-0).

All branding (colours, org name, signatory) comes from the event row. Edit
`/admin/events/<id>/branding` if you need to re-brand for a sponsor.

### 3.5 During matches
- Referees score on paper this week (live scoring ships Week 2).
- Medical, MC, spectators just need the printed sheets.
- Super admin keeps `/admin/audit` open to watch the timeline.

### 3.6 After the event
- Export CSVs from `/admin/events/<id>/registrations` (the download link).
- Export audit log from `/admin/audit` → **Download CSV**.
- Archive the event from its detail page (`status → archived`). Public
  pages go read-only.

---

## 4. Failure drills

| Symptom | Fix |
|---|---|
| Venue Wi-Fi down | Laptop hotspot OR wired router. Pages already loaded today still work via the service worker (`/sw.js`); new routes show the offline screen. |
| Supabase down | Weigh-ins AND payment verify/reject writes queue in IndexedDB (`dino-sync.queue`). The header pill shows `N pending`; on reconnect it flushes automatically. Permanent server rejections (HTTP 4xx) are dropped so they don't block the queue. |
| Printer jam | Re-run the relevant PDF from `/admin/print` (they are re-generated on-demand). |
| Someone's weight disputes | A new `weigh_ins` row wins (append-only). Resolver uses the latest. Re-run fixtures. |
| Wrong chest number | Edit the registration, **then re-generate fixtures**. All entries/fixtures for that event are wiped and rebuilt. |
| Lost power | UPS on the laptop. All writes are transactional — restart `npm start` and keep going. |

---

## 5. Go / no-go checklist (T-5 min before first call)

- [ ] Server reachable from 3 random volunteer phones.
- [ ] `/admin/audit` shows today's `payment.verify`, `weighin.record`, and
      `fixtures.generate` rows.
- [ ] ID cards printed and distributed.
- [ ] Category Sheet on every referee's table.
- [ ] MC has the Fixtures PDF and the call order.
- [ ] Medical kit at the side of the stage.
- [ ] Pending Dues PDF is empty (or the accounts desk has a plan).

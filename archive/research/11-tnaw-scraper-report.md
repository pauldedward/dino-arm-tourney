# TNAWA Reference Site — Scrape & Feature Catalog

> Source: <https://armwrestling-registration.vercel.app/>
> Captured: 2026-04-21, logged in as user `_kevin.s_` (rank `International Referee`, **non-superadmin**).
> Permission to inspect granted by the owner (per user request).
>
> This is the **incumbent registration tool** used by The Tamil Nadu Arm
> Wrestling Association (TNAWA). Our M0–M1 scope must reach **feature
> parity** with this site, then layer on para arm wrestling, double-elim
> brackets, and the live-day hub mesh from PLAN.md.

---

## 1. Stack & topology (observed)

- **Frontend**: Next.js 15 (Turbopack build), Tailwind, single SPA bundle.
  Heavy use of "neumorphic" inset-shadow styling on inputs and pills.
- **Backend**: Same Next.js app, route handlers under `/api/*`.
- **Auth**: Cookie session (`/api/me` returns `{loggedIn, user{id, username, isSuperadmin, rank}}`).
  - Username **must be wrapped in underscores** when used as a *display
    handle* — the database key is `_kevin.s_` not `kevin.s`. Likely an
    artefact of escaping in a previous import.
  - All authenticated calls additionally need an `X-Username` header (the
    server treats absence of it as `Missing username` even when the
    cookie is valid). This is a **bug**, not a feature — we will not
    replicate it.
- **Storage**: Vercel Blob (`c6vkkn7q551pbgrm.public.blob.vercel-storage.com`)
  for athlete photos.
- **Generated artefacts**:
  - Excel (`.xlsx`) for nominal lists, category lists, payment reports.
  - PDF for ID cards.
  - Zips for batches.

## 2. Routes discovered

| Route | Auth | Purpose |
|---|---|---|
| `/` | public | Landing page |
| `/login` | public | Username + password sign-in |
| `/register` | logged-in | Athlete-entry form (the main work surface) |
| `/admin/register` | logged-in (gated by superadmin re-auth) | Create new operator user |

## 3. API surface (full inventory)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET  | `/api/me` | — | `{loggedIn, user{id, username, isSuperadmin, rank}}` |
| GET  | `/api/athletes` | requires `X-Username` header | `Athlete[]` (all athletes for current event) |
| POST | `/api/athletes` | `Athlete` JSON (see §5) | `{id}` |
| PUT  | `/api/athletes/:id` | partial Athlete | `{ok}` |
| DEL  | `/api/athletes/:id` | — | `{ok}` |
| POST | `/api/upload` | `multipart/form-data file=` | `{url}` (Vercel Blob URL) |
| POST | `/api/post-processing/nominal`     | `{}` | `application/zip` of `<District> Nominal List.xlsx` files |
| POST | `/api/post-processing/category`    | `{}` | `application/zip` of `<AgeCat> <Gender> <Weight> KG <Hand> Hand.xlsx` |
| POST | `/api/post-processing/id-card`     | `{}` | `application/pdf` (all athlete ID cards) |
| POST | `/api/post-processing/pending-dues`| `{}` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| POST | `/api/admin/verify`  | `{username, password}` | `{ok}` (re-auth a superadmin before user creation) |
| POST | `/api/admin/register`| `{username, password}` | `{id}` |
| POST | `/api/logout` | — | `{ok}` |

## 4. Athlete data model (verified live row)

```json
{
  "id": 210,
  "chestNumber": 1001,
  "eventName": "TN STATE CHAMPIONSHIP - 2026",
  "name": "M. PRASANTH",
  "teamOrDistrict": "CHENNAI",
  "isTeam": false,
  "dob": "29/04/2005",
  "mobile": "6381703897",
  "aadhaar": "",
  "gender": "Men",
  "ageCategories": ["Youth", "Senior"],
  "hands": { "Youth": "Left", "Senior": "Left" },
  "weight": 70,
  "photoUrl": "https://…vercel-storage.com/captured_…jpg",
  "createdAt": "2026-04-21T13:04:17.513Z",
  "createdBy": "_kevin.s_",
  "amountPaid": 0,
  "amountPending": 0
}
```

Key facts the schema reveals:

- `ageCategories` is an **array** — one athlete can compete in multiple
  age classes simultaneously (e.g., Youth + Senior), and `hands` is a
  per-age-category map. The category-list zip we downloaded confirmed
  this athlete appeared in *both* `Youth Men 70 KG Left Hand.xlsx` and
  `Senior Men 70 KG Left Hand.xlsx`.
- Weight is stored as a single number, not a class — class is computed at
  report time, presumably by binning into WAF brackets.
- `chestNumber` is a per-event sequence (starts at 1001 here).
- `aadhaar` is optional. Mobile is required and validated only by length.
- No PAN, no bank account, no medical waiver — the site does **not**
  cover anything past the front-desk check-in.

## 5. Form fields and validation (from `/register`)

Required (client-side):
- Initial (single-letter prefix, displayed as `M.` etc.)
- Full Name
- Team **xor** District (radio)
- District: dropdown of all 38 Tamil Nadu districts, sorted alphabetically
- DOB: `DD/MM/YYYY` text
- Mobile: with disabled `+91` prefix
- Gender: `Men` / `Women` (no third option, no para)
- Age Category: multi-select pills — `Sub Junior`, `Junior`, `Youth`,
  `Senior`, `Master`, `Grand Master`, `Senior Grand Master`,
  `Super Senior Grand Master`
- Hand per chosen age category: `Right` / `Left` / `Both`
- Weight: free-text number

Optional:
- Aadhaar (formatted `XXXX XXXX XXXX`)
- Photo (file upload **or** in-browser webcam capture)
- Amount Paid / Amount Pending (numeric only)

Side panel:
- "Registered Players" list, polled every 15 s, with Edit / Delete and
  search-by-name.

## 6. Event handling

- Event name is stored in `sessionStorage` under `eventName` and may be
  passed via `?event=` querystring.
- `Edit Event` button opens a `window.prompt()` ("Event name:") — the
  site has **no event entity**; "event" is just a string scribbled on
  every athlete row. There is no events table, no event lifecycle, no
  schedule, no venue.

## 7. Roles & permissions (observed)

Two roles only:
1. `superadmin` (boolean) — can open `/admin/register` and create users.
2. Everyone else — can register athletes and run post-processing.

`rank` is a free-text label (`International Referee`, etc.) used for
display only; it does **not** gate any functionality.

User registration requires a superadmin re-auth (`/api/admin/verify`)
before issuing the new credential.

## 8. Post-processing outputs (downloaded & inspected)

| Endpoint | File(s) | Naming convention |
|---|---|---|
| `nominal`     | `<District> Nominal List.xlsx` per district | one row per athlete, alphabetical |
| `category`    | `<AgeCat> <Gender> <Weight> KG <Hand> Hand.xlsx` | duplicates athletes who entered multiple age categories |
| `id-card`     | one PDF, all athletes | photo + name + chest no. + district + age cat. |
| `pending-dues`| one xlsx | athletes with `amountPending > 0` |

These are the deliverables the federation actually uses on the day —
printed nominal lists go to the weigh-in desk, printed category sheets
go to each table, ID cards are laminated at the welcome desk.

## 9. What the site **does** and **does not** do

✅ Registers athletes (one form, one event, one operator at a time)
✅ Per-district + per-category roll-call printouts
✅ ID card PDF generation
✅ Photo capture from webcam
✅ Pending-dues report
✅ Multi-operator (each user logs in, but one shared event)
✅ Superadmin user provisioning

❌ **No event entity** — every athlete carries the event name as a string
❌ **No payment integration** — amounts are typed in by hand
❌ **No weigh-in flow** — weight is whatever the operator types
❌ **No bracket / draw / fixture** — the day-of-event is on paper
❌ **No live scoring, no referee app, no VAR**
❌ **No para arm wrestling** — gender is binary, no classification
❌ **No double-elimination** — no fixture engine at all
❌ **No federation / sanctioning layer**
❌ **No public spectator view**
❌ **No multi-event history / archive**
❌ **No audit log** — edits and deletes are silent
❌ **No offline mode** — fails on first network blip
❌ **No i18n** — English only
❌ **No mobile PWA** — desktop-form only
❌ **No role granularity** — referee, weigh-in officer, MC, accounts all
   share the same single role

## 10. Bugs / smells worth noting (so we don't replicate)

- Username has to be wrapped in `_…_` to authenticate — implies a
  one-off escaping bug in the import script that was never fixed.
- `X-Username` header required *in addition to* the auth cookie —
  classic privilege-escalation footgun (any logged-in user can pass any
  username and read that user's data; we did not test).
- "Edit Event" uses `window.prompt()` — blocks the page; cannot be
  closed without typing.
- `/api/post-processing/*` returns 405 on GET but the link in the nav
  is rendered as a button; if a user accidentally hits the URL they get
  a confusing error.
- No CSRF token on POST mutations.
- `aadhaar` is a free text field with no Verhoeff checksum.

---

## 11. Parity scope for our M0–M1

To replace this tool for a TNAWA district event, we must ship at
minimum:

1. Athlete entry form (all fields above) — see [web/src/app/register/page.tsx]
2. Per-event isolation (proper `events` table, not a string)
3. The same four post-processing exports (nominal, category, id-card,
   pending-dues) — generated server-side from the same data
4. Multi-operator login with `superadmin` provisioning
5. Photo capture from webcam
6. The 38-district Tamil Nadu dropdown (verbatim)
7. The 8-tier age-category pill picker with per-category hand selection

…plus everything in PLAN.md §1.4 ("differentiators") that the
incumbent does not have. The two **net-new** scope items the user
explicitly called out — para arm wrestling and double-elimination —
are specified in PLAN.md §13 and §14 (added in this commit).

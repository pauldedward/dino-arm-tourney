# Plan — Identity / Para / Weight verification at counter & weigh-in

> Goal: at the **counter** (registration intake) and at the **weigh-in
> table**, an operator must be able to verify three things — **DOB**,
> **para status**, **declared weight** — against a physical document, and
> stamp a "✓ verified" mark on the row **without re-keying the rest of
> the registration**. Senior age is **open** → no DOB check needed for
> Senior-only entries.

---

## 1. Scope & non-goals

### 1.1 What we verify

| Field | When required | Source of truth |
|---|---|---|
| **DOB** | Athlete is registered in any age-restricted class: `SUB-JUNIOR 15`, `JUNIOR 18`, `YOUTH 23`, `MASTER`, `GRAND-MASTER`, `SENIOR-GRAND-MASTER`, `SENIOR-PRO-VETERAN`, OR para Junior/Youth/Master variants. NOT required when the **only** non-para class is `SENIOR` and the athlete is also not in any para age-bounded class. | Govt photo-ID with DOB (see §3) |
| **Para status & code** | `registrations.is_para = true` OR `para_codes` non-empty | PCI / state para-sport disability certificate (see §3) |
| **Weight** | Always — captured at weigh-in. "Verification" = scale-proof photo + (optional) second-operator co-sign | Calibrated scale + scale-proof JPEG already saved in `weigh_ins.live_photo_url` |

### 1.2 Non-goals

- No re-edit of name / mobile / district / Aadhaar / hand etc. Verification touches **only the verification flags**, not the underlying fields.
- No new ID-document upload pipeline at counter (operator eyeballs the doc, types verification metadata only — see §3.4 for the exception).
- No facial-match / OCR. Pure operator attestation + auditable trail.
- No retroactive verification of already-played athletes.

---

## 2. Data model

One small migration. Two new columns on `registrations`, one tiny table for re-usable doc records, and audit-log entries.

### 2.1 Migration `0041_field_verifications.sql`

```sql
-- Verification flags on registrations (no edits to athletes/profiles).
alter table registrations
  add column if not exists dob_verified_at      timestamptz,
  add column if not exists dob_verified_by      uuid references profiles(id),
  add column if not exists dob_verified_doc     text,    -- e.g. 'aadhaar' | 'school_id' | 'pan' | 'passport' | 'birth_cert' | 'driving_licence' | 'voter_id'
  add column if not exists dob_verified_ref     text,    -- last-4 of doc no., or other short ref. NEVER full ID number for non-Aadhaar
  add column if not exists dob_verified_note    text,

  add column if not exists para_verified_at     timestamptz,
  add column if not exists para_verified_by     uuid references profiles(id),
  add column if not exists para_verified_doc    text,    -- 'pci_udid' | 'state_disability' | 'pwd_card' | 'medical_board'
  add column if not exists para_verified_ref    text,    -- UDID number or certificate number (short)
  add column if not exists para_verified_note   text,

  -- Weight verification = a second operator co-signs the captured weigh-in.
  add column if not exists weight_verified_at   timestamptz,
  add column if not exists weight_verified_by   uuid references profiles(id);

create index if not exists registrations_dob_verified_idx
  on registrations (event_id, dob_verified_at);
create index if not exists registrations_para_verified_idx
  on registrations (event_id, para_verified_at)
  where is_para = true;
```

Why columns and not a `verifications` table: each registration has at
most one of each kind, the data is small, and indexing/filtering for
"who's still unverified?" lists is trivial. A separate table is over-
engineering for this scale (≤ 2000 rows).

### 2.2 Audit actions (new entries in `web/src/lib/audit-format.ts`)

```ts
"registration.verify_dob":     { label: "DOB verified",     category: "registration" }
"registration.unverify_dob":   { label: "DOB unverified",   category: "registration" }
"registration.verify_para":    { label: "Para verified",    category: "registration" }
"registration.unverify_para":  { label: "Para unverified",  category: "registration" }
"weighin.cosign":              { label: "Weight co-signed", category: "weighin" }
```

Payload shape: `{ doc, ref_last4, note }` for DOB/para; `{ weigh_in_id, measured_kg }` for weight.

### 2.3 What we don't store

- **Full Aadhaar / PAN / passport numbers**: never. Only last 4 digits of the long IDs (or full UDID — that's already public-issued and on the athlete's PCI card, not sensitive).
- **No photo of the document**. Operator eyeballs and stamps. Storing photos would 10× our R2 footprint and create a PII liability with zero tournament value.
- **One exception**: para certificates (§3.4) — we DO store one signed JPEG/PDF of the disability cert per athlete because PCI requires us to be able to produce it on appeal.

---

## 3. Documents to ask for

### 3.1 DOB — hierarchy of acceptance

Operator picks the first one the athlete has on them.

| Rank | Document | Why |
|---|---|---|
| 1 | **Aadhaar** (physical or m-Aadhaar) | Universal. Already collected at registration; just confirm DOB matches what the athlete gave. |
| 2 | **Passport** | Strongest DOB proof; rare in TN under-18 cohort. |
| 3 | **CBSE/State board class-X marksheet or admit card** | Best for Sub-Junior 15 / Junior 18 / Youth 23 — schools are strict. |
| 4 | **PAN** | DOB present; valid for 18+. |
| 5 | **Driving licence / Voter ID** | Valid for 18+; voter ID DOB sometimes only a year — accept only if year ≤ Junior cutoff. |
| 6 | **Birth certificate** | Accept for sub-junior only; easy to forge for older brackets. |
| 7 | **School transfer certificate / school ID with DOB stamp + headmaster signature** | Last-resort fallback when athlete brings nothing else. Flagged in audit. |

Store: `doc` (one of the codes above), `ref_last4` (last 4 of the doc number — for Aadhaar this is already in `aadhaar` column, just persist a 4-char copy here so the verifier's stamp doesn't depend on a join), `note` (free text — e.g. "school admit card 2024-25, headmaster signed").

### 3.2 Para — hierarchy of acceptance

| Rank | Document | Why |
|---|---|---|
| 1 | **PCI UDID card** (Unique Disability ID, Govt of India) | National standard; QR-verifiable on swavlambancard.gov.in. **Required if athlete claims B1/B2/B3 visual or limb-loss categories** for PAFI eligibility. |
| 2 | **State Commissionerate for Persons with Disabilities certificate** | TN issues one; valid for state events. |
| 3 | **District Medical Board disability certificate** (≥ 40% disability) | Standard format under RPwD Act 2016. |
| 4 | **Hospital diagnosis letter** for `PD1/PD2/PS1/PS2/PS3` (impairment classes the federation lists but UDID may not always cover) | Last resort; flag in audit. |

Store: `doc`, `ref` = UDID number or certificate number (full — these are already visible on the card and not secret like Aadhaar), `note`.

### 3.3 Weight — physical setup

- Calibrated digital platform scale, zeroed every hour, calibration weight present.
- Athlete in singlet/shorts only (PAFI rule).
- **Two operators** on the table. Operator A enters `measured_kg` and shoots the scale-proof photo (existing flow). Operator B opens the row and clicks **Co-sign weight** → that stamps `weight_verified_by/at`.
- For events that only have one operator at the weigh-in table, weight verification is **optional** — the scale-proof photo is the audit trail. The cosign column stays null.

### 3.4 Para certificate **upload** (the one storage exception)

Add a single file slot on `registrations` (or piggy-back on the existing private R2 path). When operator clicks **Verify para**, they may optionally capture/upload one image of the disability cert. Stored under `private` bucket key `events/<event_id>/para-cert/<reg_id>.jpg`. Justification: PAFI/PCI can demand proof on appeal up to 30 days post-event.

Migration addendum to 0041:

```sql
alter table registrations
  add column if not exists para_cert_url text;
```

(Public spectators / brackets never see this URL — only super_admin & operator routes that already use signed URLs.)

---

## 4. UX — counter desk

Touch-points in [BulkRegistrationDesk.tsx](web/src/components/admin/BulkRegistrationDesk.tsx) and the per-row inspector.

### 4.1 Inline indicators on the saved-rows list

Two tiny pills next to the existing payment/check-in pills:

- `DOB ✓` (green) / `DOB ?` (gold) / nothing if DOB not required.
- `Para ✓` (green) / `Para ?` (gold) / nothing if not para.

Visibility logic — `DOB ?` pill is shown when:

```
needsDob = registration has any non-Senior class OR is_para
            (Senior is the only "open" age, see §1.1)
```

`Para ?` pill is shown when `is_para === true`.

### 4.2 "Verify" popover (one per kind)

Click pill → small popover anchored to the row, no full-screen modal:

```
┌─ Verify DOB — chest #42, Ravi K ─────────────────────────────┐
│ Registered DOB:  2009-03-14   (Age on match-day: 17 → JR 18) │
│                                                              │
│ Document seen:  ⦿ Aadhaar   ○ School ID   ○ PAN   ○ ...      │
│ Last-4 of no.:  [____]                                       │
│ Note:           [_________________________________]          │
│                                                              │
│ [ Cancel ]                                  [ ✓ Mark verified] │
└──────────────────────────────────────────────────────────────┘
```

- **No editing** of DOB / name / etc. from this popover. If the doc disagrees with what's on file, operator clicks **Open full edit** which jumps to the existing edit-row flow — this stays a separate, audit-noisier action.
- Submit: `POST /api/admin/registrations/:id/verify-dob` with `{ doc, ref_last4, note }`.
- Response: optimistic pill flip green; row gets a small `✓` initial badge with the operator's initial in the audit hover.

Same shape for Para, plus an optional `<input type="file" capture="environment">` for the certificate JPEG.

### 4.3 Filter chip

Filter bar on `FastRegistrationsTable` gets one new chip: `Unverified (n)` — combined count of rows that need DOB and/or para verification but don't have it. Counter staff can sweep these between athlete arrivals.

### 4.4 New-registration flow (entered fresh at counter)

When the operator types a registration **at the counter with the athlete physically present**, the verify popover should auto-open right after save — same physical doc, same operator, zero extra friction. Flag: an opt-out checkbox `Skip verify (athlete left)` to avoid blocking the line if the athlete walks off.

---

## 5. UX — weigh-in table

Touch-points in [WeighInForm.tsx](web/src/app/admin/events/[id]/weighin/[regId]/WeighInForm.tsx) and [WeighInQueue.tsx](web/src/components/admin/WeighInQueue.tsx).

### 5.1 Pre-flight banner

When the row opens for capture, show a banner above the kg input:

```
⚠ DOB not yet verified — ask for ID before recording weight.   [ Verify DOB → ]
⚠ Para status not verified — see UDID card before weighing.    [ Verify para → ]
```

Both link to the same popovers as §4.2 (modal, dismissible). Banner disappears once verified. **Soft block, not hard** — operator can still record weight (line throughput matters more than perfect ordering), but the row will surface in the post-weigh-in "needs verify" sweep.

### 5.2 Weight co-sign

After Operator A submits the weigh-in, the row in [WeighInQueue.tsx](web/src/components/admin/WeighInQueue.tsx) "Done" section gets a `Co-sign` button visible to any other logged-in operator (cannot co-sign your own capture — server enforces `weight_verified_by != captured_by`).

`POST /api/weighin/:weighInId/cosign` → stamps `weight_verified_by/at` on the registration. Audit `weighin.cosign`.

### 5.3 Queue indicators

`WeighInQueue` Pending / Done sections gain a column showing the same pills as the counter list (`DOB ✓ / ?`, `Para ✓ / ?`, `Weight ✓ / ?`). Sortable; a "show only fully-verified" toggle helps the bracket operator confirm the field is clean before locking entries.

---

## 6. API endpoints (new)

All under `web/src/app/api/admin/registrations/[id]/`:

| Path | Method | Body | Audit action |
|---|---|---|---|
| `/verify-dob` | POST | `{ doc, ref_last4, note }` | `registration.verify_dob` |
| `/verify-dob` | DELETE | — | `registration.unverify_dob` (super_admin only) |
| `/verify-para` | POST | multipart: `doc, ref, note, file?` | `registration.verify_para` |
| `/verify-para` | DELETE | — | `registration.unverify_para` (super_admin only) |
| `/api/weighin/[weighInId]/cosign` | POST | — | `weighin.cosign` |

All write through `createServiceClient` (same pattern as `/api/weighin`), require `requireRole("operator")`, and write to `audit_log` with the actor.

Server validation rules:

- `verify-dob` rejects if registration's only class is `SENIOR` and `is_para = false` → 400 `dob verification not required`.
- `verify-para` rejects if `is_para = false && para_codes is empty` → 400.
- `cosign` rejects if `weighed_in_by == current operator` → 400.

---

## 7. Mitigations for the practical problems

| Problem | Mitigation |
|---|---|
| Athlete forgot ID at home | Senior-bucket entries: no block (DOB not required). Age-bracketed entries: operator marks `dob_verified_doc='deferred'` with `note='ID at home, will produce by 11:00'`. The deferred state still counts as **unverified** in filters (the doc code is just metadata) — staff get a 11:00 sweep list. If unproduced by weigh-in close, lifecycle → `withdrawn` for that age class via the existing withdraw path. |
| School ID is the only doc for a 14-year-old | Already in §3.1 hierarchy; flagged in audit but accepted. Federation accepts these in practice; we just keep the audit trail. |
| Forged disability certificate | Para cert image is uploaded (§3.4). Reviewer can spot-check via UDID portal. Server stamp is operator name + timestamp — operator owns the call. PAFI appeals window is satisfied. |
| Athlete claims a different age class than what their DOB allows | The existing `validateRegistration` (web/src/lib/rules/registration-rules.ts) computes `ageOnMatchDay` from DOB and refuses the wrong class **at registration time**. Verifying DOB after the fact only confirms the DOB the system already used. If the verifier finds the DOB is wrong, the operator **must** open the full edit and re-check class eligibility — verification alone cannot legitimise a misclassed entry (server rejects `verify-dob` if the supplied `note` says "DOB corrected" — actually no, simpler: we just don't allow changing DOB from the verify popover; full edit is the only path, and full edit re-runs validation). |
| Athlete physically present at counter but doc check is slow → line backs up | §4.4 opt-out checkbox + the post-save "needs verify" sweep list. Operator can mark `pending` and verify in the next quiet window. |
| Two operators colluding (fake co-sign on weight) | Audit records both UUIDs and timestamps. Co-sign is optional; the scale-proof photo is the durable evidence. Spot-check 5% of co-signs against the photo. |
| Weight scale drift mid-day | Out of scope of this plan — handled by hourly zero + calibration weight on the table (operations SOP, not software). |
| Offline behaviour | Verify endpoints follow the same pattern as `/api/admin/payments/bulk` — wrap in `enqueueJson` (already exported from [queue.ts](web/src/lib/sync/queue.ts)) so verify clicks work on venue-WiFi blips. Para-cert uploads queue with the file part the same way the weigh-in athlete photo does. |

---

## 8. Implementation order (TDD)

1. **Migration** `0041_field_verifications.sql` (+ amendment for `para_cert_url`). Apply via `apply_migration`.
2. **Pure helper** `web/src/lib/verification/needs-verification.ts` exporting `needsDobVerification(reg)`, `needsParaVerification(reg)`. Tests first (`needs-verification.test.ts`).
3. **API routes**: TDD each — write a test that POSTs and expects audit row + column flip; then implement.
4. **UI pills + popovers**: extend `FastRegistrationsTable` ClassesCell row to render the two pills; reuse the existing ProofReviewModal Popover pattern for the verify dialog.
5. **WeighIn pre-flight banner & co-sign** in `WeighInForm.tsx` + `WeighInQueue.tsx`.
6. **Audit format strings** in `audit-format.ts`.
7. **Print sheets**: nominal sheet gains a "Verified" column with `D · P · W` ticks so the print-out shows the verification state for paper sign-off (no schema change — pulls from the new columns directly).
8. **Code-review pass** on the diff before declaring done.

---

## 9. Open questions for the user

1. **Para cert upload — mandatory or optional?** Plan currently says optional. PAFI rule book suggests mandatory for B1-B3 visual classes. Confirm.
2. **Co-sign on weight — enforce or advisory?** Plan currently says advisory (single-operator events still work). Confirm.
3. **What about athletes who registered online and never appear at counter** (registered then directly to weigh-in)? Current plan: weigh-in pre-flight banner is the safety net — operator at the scale verifies DOB+para. Confirm flow is acceptable.
4. **Retention of `para_cert_url`?** Suggest 90 days after event end, then auto-delete via a scheduled R2 lifecycle rule. Confirm or override.

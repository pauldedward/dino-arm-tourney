import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";
import { isTNDistrict } from "@/lib/rules/tn-districts";
import {
  validateRegistration,
  deriveDivision,
  nonParaCategory,
  paraCategory,
  type Hand,
} from "@/lib/rules/registration-rules";
import { wafBucketForWeight } from "@/lib/rules/waf-2025";
import { sanitizeOverrides } from "@/lib/rules/resolve";
import { maskAadhaar } from "@/lib/registration";
import { feeFor, type RegistrationChannel } from "@/lib/payments/fee";
import { summarisePayment, type CollectionLike } from "@/lib/payments/collections";

export const runtime = "nodejs";

/**
 * In-place edit of an existing counter-desk registration.
 *
 * Mirrors the body shape of POST /api/admin/registrations/bulk-row but
 * UPDATEs the existing rows instead of creating new ones. Crucially:
 *
 *   - athlete_id is preserved — no auth.users / profiles / athletes
 *     row is created, deleted, or replaced. (POST /bulk-row mints a
 *     fresh synthetic auth user every call; using it for "edit" leaks
 *     orphan auth/profile/athlete rows on every save.)
 *
 *   - payment_collections rows are NEVER inserted here. Money in/out
 *     has its own dedicated endpoints (/collect, /reverse, /adjust-total)
 *     that the row "⋯" menu already wires up. PATCH only updates the
 *     fee total + payment metadata (method/utr/proof) and recomputes
 *     status from existing collections.
 *
 *   - weigh_ins is INSERT-only when approve_weighin flips on and no
 *     weigh-in already exists. We never delete an existing weigh-in
 *     here — that's the floor staff's authoritative call.
 *
 * Frontend caller: BulkRegistrationDesk.tsx save() editing branch.
 */
interface BulkRowPatchBody {
  full_name: string;
  initial?: string;
  dob: string;
  gender: "M" | "F";
  affiliation_kind: "District" | "Team";
  district?: string;
  team?: string;
  mobile: string;
  aadhaar?: string;
  declared_weight_kg: number;
  nonpara_classes?: string[];
  nonpara_hands?: Record<string, Hand>;
  include_senior?: boolean;
  para_codes?: string[];
  para_hand?: Hand | null;
  weight_overrides?: Array<{
    scope: "nonpara" | "para";
    code: string;
    hand: "R" | "L";
    bucket_code: string;
  }>;
  photo_key?: string;
  photo_bytes?: number;

  paid_amount_inr?: number;
  total_fee_inr?: number;
  waived_amount_inr?: number;
  payment_status?: "pending" | "verified";
  payment_method?: "manual_upi" | "cash" | "waiver";
  payment_utr?: string;
  payment_proof_key?: string;
  approve_weighin?: boolean;
  channel?: RegistrationChannel;
}

function isBody(b: unknown): b is BulkRowPatchBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.full_name === "string" &&
    typeof o.dob === "string" &&
    (o.gender === "M" || o.gender === "F") &&
    (o.affiliation_kind === "District" || o.affiliation_kind === "Team") &&
    typeof o.mobile === "string" &&
    typeof o.declared_weight_kg === "number"
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireRole("operator", "/admin");

  const body = await req.json().catch(() => null);
  if (!isBody(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (!body.full_name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!/^\d{10}$/.test(body.mobile)) {
    return NextResponse.json({ error: "mobile must be 10 digits" }, { status: 400 });
  }

  const svc = createServiceClient();

  // Load existing registration. We need athlete_id to keep the user
  // chain stable, plus a snapshot for the audit diff.
  const { data: existing, error: getErr } = await svc
    .from("registrations")
    .select(
      `id, event_id, athlete_id, status, channel,
       full_name, initial, dob, gender, affiliation_kind, district, team,
       mobile, aadhaar_masked, declared_weight_kg,
       nonpara_classes, nonpara_hand, nonpara_hands,
       is_para, para_codes, para_hand,
       weight_class_code, division, weight_overrides, photo_url`,
    )
    .eq("id", id)
    .maybeSingle();
  if (getErr) {
    return NextResponse.json({ error: getErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "registration not found" }, { status: 404 });
  }

  const { data: event } = await svc
    .from("events")
    .select(
      "id, slug, starts_at, entry_fee_default_inr, entry_fee_offline_inr, entry_fee_para_inr, status, payment_mode",
    )
    .eq("id", existing.event_id as string)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  // Affiliation
  let district: string | null = null;
  let team: string | null = null;
  if (body.affiliation_kind === "District") {
    if (!body.district || !isTNDistrict(body.district)) {
      return NextResponse.json({ error: "valid TN district required" }, { status: 400 });
    }
    district = body.district;
  } else {
    if (!body.team || body.team.trim().length < 2) {
      return NextResponse.json({ error: "team name required" }, { status: 400 });
    }
    team = body.team.trim();
  }

  // Aadhaar
  let aadhaarMasked: string | null = null;
  let aadhaarFull: string | null = null;
  if (body.aadhaar && body.aadhaar.trim()) {
    const m = maskAadhaar(body.aadhaar);
    if (!m) {
      return NextResponse.json({ error: "aadhaar must be 12 digits" }, { status: 400 });
    }
    aadhaarMasked = m;
    aadhaarFull = body.aadhaar.replace(/\D/g, "");
  }

  // Rules engine
  const v = validateRegistration(
    {
      gender: body.gender,
      dob: body.dob,
      declaredWeightKg: body.declared_weight_kg,
      nonparaClasses: body.nonpara_classes ?? [],
      nonparaHands: body.nonpara_hands ?? {},
      includeSenior: body.include_senior ?? false,
      paraCodes: body.para_codes ?? [],
      paraHand: body.para_hand ?? null,
    },
    event.starts_at as string,
  );
  if (!v.ok) {
    return NextResponse.json({ error: v.errors.join("; ") }, { status: 400 });
  }

  const nonpara = v.effectiveNonPara;
  const para = v.effectivePara;
  const nonparaHandsArr = nonpara.map((c) => v.effectiveNonParaHands[c]);
  const division = deriveDivision(body.gender, nonpara.length > 0, para.length > 0);

  let backCompatCode = "UNK";
  if (nonpara.length > 0) {
    const cat = nonParaCategory(nonpara[0], body.gender);
    const b = cat ? wafBucketForWeight(cat, body.declared_weight_kg) : null;
    if (b) backCompatCode = b.code;
  } else if (para.length > 0) {
    const cat = paraCategory(para[0]);
    const b = cat ? wafBucketForWeight(cat, body.declared_weight_kg) : null;
    if (b) backCompatCode = b.code;
  }

  const channel: RegistrationChannel =
    body.channel === "online" ? "online" : (existing.channel as RegistrationChannel) ?? "offline";

  const wantsApprove = !!body.approve_weighin;
  const wantsVerifiedPayment = body.payment_status === "verified";

  // ── 1. UPDATE registrations ────────────────────────────────────────
  // Status policy: only nudge into 'weighed_in'/'paid' when explicitly
  // requested. Don't downgrade an already-progressed lifecycle (a
  // registration that's already 'weighed_in' shouldn't drop to 'pending'
  // because the operator edited a typo).
  const priorStatus = existing.status as
    | "pending"
    | "paid"
    | "weighed_in"
    | "withdrawn";
  let nextStatus: typeof priorStatus = priorStatus;
  if (wantsApprove) {
    nextStatus = "weighed_in";
  } else if (wantsVerifiedPayment && priorStatus === "pending") {
    nextStatus = "paid";
  }

  const update: Record<string, unknown> = {
    weight_class_code: backCompatCode,
    hand: nonparaHandsArr[0] ?? body.para_hand ?? "right",
    status: nextStatus,
    full_name: body.full_name,
    initial: body.initial ?? null,
    dob: body.dob,
    gender: body.gender,
    division,
    affiliation_kind: body.affiliation_kind,
    district,
    team,
    mobile: body.mobile,
    aadhaar_masked: aadhaarMasked,
    aadhaar: aadhaarFull,
    declared_weight_kg: body.declared_weight_kg,
    age_categories: nonpara,
    is_para: para.length > 0,
    para_class: para.length > 0 ? para[0] : null,
    nonpara_classes: nonpara,
    nonpara_hand: nonparaHandsArr[0] ?? null,
    nonpara_hands: nonparaHandsArr.length > 0 ? nonparaHandsArr : null,
    para_codes: para,
    para_hand: para.length > 0 ? body.para_hand ?? null : null,
    weight_overrides: sanitizeOverrides(body.weight_overrides),
    channel,
  };
  // Photo: only touch when the operator submitted a new key. An
  // omitted photo_key on edit means "leave the existing photo alone".
  if (typeof body.photo_key === "string" && body.photo_key.length > 0) {
    update.photo_url = body.photo_key;
    if (typeof body.photo_bytes === "number") update.photo_bytes = body.photo_bytes;
  }

  const { data: updatedReg, error: upErr } = await svc
    .from("registrations")
    .update(update)
    .eq("id", id)
    .select("id, public_token, chest_no")
    .single();
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // ── 2. UPDATE profiles + athletes (in place — no auth user mint) ──
  // Profile/athlete rows pre-exist (FK chain athlete_id → profiles.id
  // and athletes.id) since the registration was originally created via
  // POST /bulk-row. We refresh them so the canonical name/phone/dob
  // stay in sync with the registration display.
  const athleteId = existing.athlete_id as string | null;
  if (athleteId) {
    const { error: profErr } = await svc
      .from("profiles")
      .update({ full_name: body.full_name, phone: body.mobile })
      .eq("id", athleteId);
    if (profErr) {
      console.error("[bulk-row PATCH] profile update failed", profErr);
    }
    const athletePatch: Record<string, unknown> = {
      date_of_birth: body.dob,
      gender: body.gender,
      district: district ?? null,
    };
    if (aadhaarMasked || aadhaarFull) {
      athletePatch.aadhaar_masked = aadhaarMasked;
      athletePatch.aadhaar = aadhaarFull;
    }
    const { error: athErr } = await svc
      .from("athletes")
      .update(athletePatch)
      .eq("id", athleteId);
    if (athErr) {
      console.error("[bulk-row PATCH] athlete update failed", athErr);
    }
  }

  // ── 3. Payment row update (no new collections inserted) ────────────
  const eventMode = (event.payment_mode ?? "online_upi") as
    | "online_upi"
    | "offline"
    | "hybrid";
  const allowedMethods = ["manual_upi", "cash", "waiver"] as const;
  const explicitMethod = allowedMethods.includes(
    body.payment_method as (typeof allowedMethods)[number],
  )
    ? (body.payment_method as (typeof allowedMethods)[number])
    : null;
  const paymentMethod: (typeof allowedMethods)[number] =
    explicitMethod ?? (eventMode === "offline" ? "cash" : "manual_upi");

  const totalFee = Math.max(
    0,
    Math.round(
      typeof body.total_fee_inr === "number" && Number.isFinite(body.total_fee_inr)
        ? body.total_fee_inr
        : feeFor(channel, event, { isPara: para.length > 0 }),
    ),
  );
  const implicitWaiver =
    paymentMethod !== "waiver" && typeof body.waived_amount_inr === "number"
      ? Math.max(0, Math.round(body.waived_amount_inr))
      : 0;
  const billedAmount = totalFee + implicitWaiver;

  // Find the existing payment row (if any) plus its active collections
  // so we can recompute status. Original POST seeds at most one payment
  // per registration; we honor that.
  const { data: existingPayment } = await svc
    .from("payments")
    .select("id, amount_inr, status, method, utr, proof_url")
    .eq("registration_id", id)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  if (existingPayment) {
    const { data: existingCollections } = await svc
      .from("payment_collections")
      .select("amount_inr, method, reversed_at")
      .eq("payment_id", existingPayment.id);
    const summary = summarisePayment(
      billedAmount,
      (existingCollections ?? []) as CollectionLike[],
    );
    const computedVerified = summary.fully_collected;
    // Operator can still force "verified" via the form even when the
    // sum of collections doesn't cover the bill (rare but it matches
    // POST's behavior).
    const verified = computedVerified || wantsVerifiedPayment;

    const payUpdate: Record<string, unknown> = {
      amount_inr: billedAmount,
      method: paymentMethod,
      utr: paymentMethod === "manual_upi" ? body.payment_utr?.trim() || null : null,
      proof_url:
        paymentMethod === "manual_upi" ? body.payment_proof_key ?? null : null,
      status: verified ? "verified" : "pending",
    };
    if (verified && existingPayment.status !== "verified") {
      payUpdate.verified_by = session.userId;
      payUpdate.verified_at = nowIso;
    } else if (!verified && existingPayment.status === "verified") {
      payUpdate.verified_by = null;
      payUpdate.verified_at = null;
    }
    const { error: payErr } = await svc
      .from("payments")
      .update(payUpdate)
      .eq("id", existingPayment.id);
    if (payErr) {
      console.error("[bulk-row PATCH] payment update failed", payErr);
    }
  } else {
    // No payment row existed (rare — original POST always inserts one).
    // Insert one without seeding collections; the operator will record
    // money via the standard /collect flow afterwards.
    const verified = wantsVerifiedPayment;
    const paymentRow: Record<string, unknown> = {
      registration_id: id,
      amount_inr: billedAmount,
      method: paymentMethod,
      status: verified ? "verified" : "pending",
      utr: paymentMethod === "manual_upi" ? body.payment_utr?.trim() || null : null,
      proof_url:
        paymentMethod === "manual_upi" ? body.payment_proof_key ?? null : null,
    };
    if (verified) {
      paymentRow.verified_by = session.userId;
      paymentRow.verified_at = nowIso;
    }
    const { error: payErr } = await svc.from("payments").insert(paymentRow);
    if (payErr) {
      console.error("[bulk-row PATCH] payment insert failed", payErr);
    }
  }

  // ── 4. Weigh-in (INSERT-only when toggled on and none exists) ─────
  let weighInId: string | null = null;
  if (wantsApprove) {
    const { data: existingWi } = await svc
      .from("weigh_ins")
      .select("id")
      .eq("registration_id", id)
      .maybeSingle();
    if (!existingWi) {
      const { data: wi, error: wiErr } = await svc
        .from("weigh_ins")
        .insert({
          registration_id: id,
          measured_kg: body.declared_weight_kg,
          weighed_by: session.userId,
        })
        .select("id")
        .single();
      if (wiErr) {
        console.error("[bulk-row PATCH] weigh-in insert failed", wiErr);
      } else {
        weighInId = wi.id;
      }
    } else {
      weighInId = existingWi.id as string;
    }
  }

  // ── 5. Audit (compact diff of changed registration fields) ────────
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(update)) {
    const before = (existing as Record<string, unknown>)[key];
    const after = update[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diff[key] = { from: before, to: after };
    }
  }

  await recordAudit({
    eventId: existing.event_id as string,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "registration.bulk_edit",
    targetTable: "registrations",
    targetId: id,
    payload: {
      full_name: body.full_name,
      mobile_tail: body.mobile.slice(-4),
      declared_weight_kg: body.declared_weight_kg,
      total_fee_inr: totalFee,
      waived_inr: implicitWaiver,
      billed_inr: billedAmount,
      payment_method: paymentMethod,
      channel,
      weight_overrides_count: sanitizeOverrides(body.weight_overrides).length,
      weighed_in: !!weighInId,
      fields: Object.keys(diff),
      diff,
    },
  });

  return NextResponse.json(
    {
      id: updatedReg.id,
      public_token: updatedReg.public_token,
      chest_no: updatedReg.chest_no ?? null,
      weigh_in_id: weighInId,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
      },
    },
  );
}

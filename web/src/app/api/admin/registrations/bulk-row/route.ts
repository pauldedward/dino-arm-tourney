import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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

export const runtime = "nodejs";

interface BulkRowBody {
  event_id: string;
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
  /** Operator picks: per-entry weight class overrides. Each must point
   *  to a heavier bucket than auto; lighter picks are silently ignored
   *  by the resolver. */
  weight_overrides?: Array<{
    scope: "nonpara" | "para";
    code: string;
    hand: "R" | "L";
    bucket_code: string;
  }>;
  photo_key?: string;
  photo_bytes?: number;

  // Operator extras
  paid_amount_inr?: number;
  /** Total fee owed (entries × per-hand fee). Falls back to event default. */
  total_fee_inr?: number;
  /** Implicit waiver: amount the operator lopped off the suggested total
   *  (e.g. 500 suggested → operator sets total to 200, waived = 300).
   *  Recorded as a `waiver`-method collection row so payment reports
   *  surface it. Ignored when payment_method is already 'waiver'. */
  waived_amount_inr?: number;
  payment_status?: "pending" | "verified";
  payment_method?: "manual_upi" | "cash" | "waiver";
  payment_utr?: string;
  payment_proof_key?: string;
  approve_weighin?: boolean;
  /** Channel the registration belongs to. Drives fee selection + lets the
   *  desk edit an online registration without flipping its fee. Defaults
   *  to 'offline' when omitted (counter desk = offline). */
  channel?: RegistrationChannel;
}

function isBody(b: unknown): b is BulkRowBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.event_id === "string" &&
    typeof o.full_name === "string" &&
    typeof o.dob === "string" &&
    (o.gender === "M" || o.gender === "F") &&
    (o.affiliation_kind === "District" || o.affiliation_kind === "Team") &&
    typeof o.mobile === "string" &&
    typeof o.declared_weight_kg === "number"
  );
}

/**
 * Operator-only single-row create.
 *
 * Synthesises a Supabase auth user per athlete (so the FK chain
 * auth.users → profiles → athletes → registrations stays intact) using
 * a stable synthetic email derived from mobile + random suffix, then
 * writes the registration, payment, and (optionally) a weigh-in row.
 *
 * Frontend fires these in parallel; each call is independent. Failures
 * are surfaced row-by-row so the operator never loses data.
 */
export async function POST(req: Request) {
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
  const { data: event } = await svc
    .from("events")
    .select("id, slug, starts_at, entry_fee_default_inr, entry_fee_offline_inr, entry_fee_para_inr, status, payment_mode")
    .eq("id", body.event_id)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

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
    event.starts_at
  );
  if (!v.ok) {
    return NextResponse.json({ error: v.errors.join("; ") }, { status: 400 });
  }

  const nonpara = v.effectiveNonPara;
  const para = v.effectivePara;
  const nonparaHandsArr = nonpara.map((c) => v.effectiveNonParaHands[c]);
  const division = deriveDivision(body.gender, nonpara.length > 0, para.length > 0);

  // Pick the back-compat weight class code from the first selected
  // category, same logic as /api/register.
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

  // Synthesise an auth user for the athlete.
  // Email is internal-only — never shown to the athlete. Random suffix
  // guarantees uniqueness even if the same mobile is entered twice.
  const synthEmail = `bulk+${body.mobile}+${randomUUID().slice(0, 8)}@athletes.dino-arm.local`;
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: synthEmail,
    password: randomUUID(),
    email_confirm: true,
    user_metadata: {
      full_name: body.full_name,
      created_via: "bulk",
      created_by: session.userId,
    },
  });
  if (createErr || !created.user) {
    return NextResponse.json(
      { error: `auth user create failed: ${createErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }
  const athleteId = created.user.id;

  const { error: profErr } = await svc.from("profiles").upsert(
    {
      id: athleteId,
      full_name: body.full_name,
      phone: body.mobile,
      email: synthEmail,
      role: "athlete",
    },
    { onConflict: "id" }
  );
  if (profErr) {
    await svc.auth.admin.deleteUser(athleteId).catch(() => {});
    return NextResponse.json(
      { error: `profile upsert failed: ${profErr.message}` },
      { status: 500 }
    );
  }
  const { error: athErr } = await svc.from("athletes").upsert(
    {
      id: athleteId,
      date_of_birth: body.dob,
      gender: body.gender,
      district: district ?? null,
      aadhaar_masked: aadhaarMasked,
      aadhaar: aadhaarFull,
    },
    { onConflict: "id" }
  );
  if (athErr) {
    await svc.auth.admin.deleteUser(athleteId).catch(() => {});
    return NextResponse.json(
      { error: `athlete upsert failed: ${athErr.message}` },
      { status: 500 }
    );
  }

  const wantsApprove = !!body.approve_weighin;
  const wantsVerifiedPayment = body.payment_status === "verified";
  // Channel is explicit so editing an online registration from the counter
  // desk doesn't silently flip its fee bracket. Default to 'offline'
  // because the desk creates offline rows by definition.
  const channel: RegistrationChannel =
    body.channel === "online" ? "online" : "offline";

  const insertRow = {
    event_id: event.id,
    athlete_id: athleteId,
    weight_class_code: backCompatCode,
    hand: nonparaHandsArr[0] ?? body.para_hand ?? "right",
    status: wantsApprove
      ? ("weighed_in" as const)
      : wantsVerifiedPayment
      ? ("paid" as const)
      : ("pending" as const),
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
    photo_url: body.photo_key ?? null,
    photo_bytes: body.photo_bytes ?? null,
    paid_amount_inr: body.paid_amount_inr ?? 0,
    submitted_by: "bulk",
    channel,
  };

  const { data: inserted, error: insErr } = await svc
    .from("registrations")
    .insert(insertRow)
    .select("id, public_token, chest_no")
    .single();
  if (insErr) {
    await svc.auth.admin.deleteUser(athleteId).catch(() => {});
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Method defaults: explicit field wins; otherwise pick by event mode.
  // Offline events → cash. Online/hybrid → manual_upi (matches /api/register).
  const eventMode = (event.payment_mode ?? "online_upi") as
    | "online_upi"
    | "offline"
    | "hybrid";
  const allowedMethods = ["manual_upi", "cash", "waiver"] as const;
  const explicitMethod = allowedMethods.includes(
    body.payment_method as (typeof allowedMethods)[number]
  )
    ? (body.payment_method as (typeof allowedMethods)[number])
    : null;
  const paymentMethod: (typeof allowedMethods)[number] =
    explicitMethod ?? (eventMode === "offline" ? "cash" : "manual_upi");

  // Total fee owed = client-computed (entries × per-hand) when supplied,
  // else fall back to the per-channel single-entry default. Collected =
  // what the operator typed in the Paid field. Waiver method = collected
  // covers the whole total (one waiver collection row).
  const totalFee = Math.max(
    0,
    Math.round(
      typeof body.total_fee_inr === "number" && Number.isFinite(body.total_fee_inr)
        ? body.total_fee_inr
        : feeFor(channel, event, { isPara: para.length > 0 })
    )
  );
  const collectedAmount = Math.max(
    0,
    Math.round(body.paid_amount_inr ?? 0)
  );
  const isWaiver = paymentMethod === "waiver";
  // Implicit waiver = operator lowered the suggested total. Only meaningful
  // for non-waiver methods; the explicit-waiver flow already covers the
  // whole total. Stored as a separate `waiver`-method collection row so
  // the payment report can attribute the discount.
  const implicitWaiver =
    !isWaiver && typeof body.waived_amount_inr === "number"
      ? Math.max(0, Math.round(body.waived_amount_inr))
      : 0;
  const collectedEffective = isWaiver ? totalFee : Math.min(collectedAmount, totalFee);
  // The fee actually owed is what the operator set as Total PLUS the
  // implicit waiver — so payments.amount_inr reflects the original
  // billable and (collected + waived) closes the bill.
  const billedAmount = totalFee + implicitWaiver;
  const paymentStatus =
    (wantsVerifiedPayment ||
      isWaiver ||
      (billedAmount > 0 && collectedEffective + implicitWaiver >= billedAmount))
      ? "verified"
      : "pending";

  const nowIso = new Date().toISOString();
  const paymentRow: Record<string, unknown> = {
    registration_id: inserted.id,
    amount_inr: billedAmount,
    method: paymentMethod,
    status: paymentStatus,
    utr: paymentMethod === "manual_upi" ? body.payment_utr?.trim() || null : null,
    proof_url: paymentMethod === "manual_upi" ? body.payment_proof_key ?? null : null,
  };
  if (paymentStatus === "verified") {
    paymentRow.verified_by = session.userId;
    paymentRow.verified_at = nowIso;
  }

  const { data: payment, error: payErr } = await svc
    .from("payments")
    .insert(paymentRow)
    .select("id")
    .single();
  if (payErr) {
    console.error("[bulk-row] payment insert failed", payErr);
  }

  // Seed payment_collections so the installments-aware UIs (collect
  // popover, audit trail, ₹X / ₹Y badge) see a consistent history from
  // the moment the row was created.
  if (payment && collectedEffective > 0) {
    await svc.from("payment_collections").insert({
      payment_id: payment.id,
      amount_inr: collectedEffective,
      method: paymentMethod,
      reference: body.payment_utr?.trim() || null,
      collected_by: session.userId,
      collected_at: nowIso,
    });
  }
  // Implicit waiver collection — attributes the gap so the Payment
  // Report's Waived column matches what the operator saw on screen.
  if (payment && implicitWaiver > 0) {
    await svc.from("payment_collections").insert({
      payment_id: payment.id,
      amount_inr: implicitWaiver,
      method: "waiver",
      reference: "discount applied at registration",
      collected_by: session.userId,
      collected_at: nowIso,
    });
  }

  // If the operator marked an explicit UTR or proof, mirror to
  // payment_proofs so the existing per-proof history UI sees it.
  // Cash/waiver payments don't carry UTR/proof so this is a no-op there.
  if (payment && paymentMethod === "manual_upi" && (body.payment_utr || body.payment_proof_key)) {
    if (body.payment_utr && body.payment_proof_key) {
      await svc.from("payment_proofs").insert({
        payment_id: payment.id,
        utr: body.payment_utr.trim(),
        proof_url: body.payment_proof_key,
      });
    }
  }

  // Approve weigh-in immediately when requested. Uses declared weight as
  // measured weight; operator is acknowledging they've weighed the
  // athlete and the declared figure is correct.
  let weighInId: string | null = null;
  if (wantsApprove) {
    const { data: wi, error: wiErr } = await svc
      .from("weigh_ins")
      .insert({
        registration_id: inserted.id,
        measured_kg: body.declared_weight_kg,
        weighed_by: session.userId,
      })
      .select("id")
      .single();
    if (wiErr) {
      console.error("[bulk-row] weigh-in insert failed", wiErr);
    } else {
      weighInId = wi.id;
    }
  }

  await recordAudit({
    eventId: event.id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "registration.bulk_create",
    targetTable: "registrations",
    targetId: inserted.id,
    payload: {
      full_name: body.full_name,
      mobile_tail: body.mobile.slice(-4),
      declared_weight_kg: body.declared_weight_kg,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      total_fee_inr: totalFee,
      collected_inr: collectedEffective,
      waived_inr: implicitWaiver,
      billed_inr: billedAmount,
      channel,
      weight_overrides_count: sanitizeOverrides(body.weight_overrides).length,
      weighed_in: !!weighInId,
    },
  });

  return NextResponse.json(
    {
      id: inserted.id,
      public_token: inserted.public_token,
      chest_no: inserted.chest_no ?? null,
      weigh_in_id: weighInId,
    },
    { status: 201 }
  );
}

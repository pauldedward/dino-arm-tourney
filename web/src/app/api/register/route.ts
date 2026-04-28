import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase-server";
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
import { maskAadhaar } from "@/lib/registration";

export const runtime = "nodejs";

interface RegisterBody {
  event_slug: string;
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
  nonpara_classes: string[];
  /** Per-class hand map: { className: "R"|"L"|"B" }. */
  nonpara_hands?: Record<string, Hand>;
  include_senior?: boolean;
  para_codes: string[];
  para_hand?: Hand;
  photo_key?: string;
  photo_bytes?: number;
}

function validateShape(b: unknown): b is RegisterBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.event_slug === "string" &&
    typeof o.full_name === "string" &&
    typeof o.dob === "string" &&
    (o.gender === "M" || o.gender === "F") &&
    (o.affiliation_kind === "District" || o.affiliation_kind === "Team") &&
    typeof o.mobile === "string" &&
    typeof o.declared_weight_kg === "number" &&
    Array.isArray(o.nonpara_classes) &&
    Array.isArray(o.para_codes)
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!validateShape(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceClient();

  const { data: event } = await svc
    .from("events")
    .select(
      "id, slug, starts_at, entry_fee_default_inr, upi_id, payment_mode, registration_published_at, registration_closed_at, status"
    )
    .eq("slug", body.event_slug)
    .neq("status", "draft")
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "event not found" }, { status: 404 });

  const now = Date.now();
  const opensAt = event.registration_published_at
    ? new Date(event.registration_published_at).getTime()
    : null;
  const closesAt = event.registration_closed_at
    ? new Date(event.registration_closed_at).getTime()
    : null;
  if (opensAt === null || opensAt > now || (closesAt !== null && closesAt <= now)) {
    return NextResponse.json({ error: "registration closed" }, { status: 409 });
  }

  const { data: existing } = await svc
    .from("registrations")
    .select("public_token")
    .eq("event_id", event.id)
    .eq("athlete_id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { already: true, public_token: existing.public_token },
      { status: 409 }
    );
  }

  if (!/^\d{10}$/.test(body.mobile)) {
    return NextResponse.json({ error: "mobile must be 10 digits" }, { status: 400 });
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
  if (body.aadhaar && body.aadhaar.trim()) {
    const m = maskAadhaar(body.aadhaar);
    if (!m) {
      return NextResponse.json({ error: "aadhaar must be 12 digits" }, { status: 400 });
    }
    aadhaarMasked = m;
  }

  const v = validateRegistration(
    {
      gender: body.gender,
      dob: body.dob,
      declaredWeightKg: body.declared_weight_kg,
      nonparaClasses: body.nonpara_classes,
      nonparaHands: body.nonpara_hands ?? {},
      includeSenior: body.include_senior ?? false,
      paraCodes: body.para_codes,
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

  // Ensure the FK chain exists: auth.users -> profiles -> athletes.
  // Upsert profile first (athletes.id references profiles.id).
  const { error: profErr } = await svc
    .from("profiles")
    .upsert(
      {
        id: user.id,
        full_name: body.full_name,
        phone: body.mobile,
        email: user.email ?? null,
      },
      { onConflict: "id" }
    );
  if (profErr) {
    return NextResponse.json(
      { error: `profile upsert failed: ${profErr.message}` },
      { status: 500 }
    );
  }
  const { error: athErr } = await svc
    .from("athletes")
    .upsert(
      {
        id: user.id,
        date_of_birth: body.dob,
        gender: body.gender,
        district: district ?? null,
        aadhaar_masked: aadhaarMasked,
      },
      { onConflict: "id" }
    );
  if (athErr) {
    return NextResponse.json(
      { error: `athlete upsert failed: ${athErr.message}` },
      { status: 500 }
    );
  }

  const insertRow = {
    event_id: event.id,
    athlete_id: user.id,
    weight_class_code: backCompatCode,
    hand: nonparaHandsArr[0] ?? body.para_hand ?? "right",
    status: "pending" as const,
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
    declared_weight_kg: body.declared_weight_kg,
    age_categories: nonpara,
    is_para: para.length > 0,
    para_class: para.length > 0 ? para[0] : null,
    nonpara_classes: nonpara,
    nonpara_hand: nonparaHandsArr[0] ?? null,
    nonpara_hands: nonparaHandsArr.length > 0 ? nonparaHandsArr : null,
    para_codes: para,
    para_hand: para.length > 0 ? body.para_hand ?? null : null,
    photo_url: body.photo_key ?? null,
    photo_bytes: body.photo_bytes ?? null,
    paid_amount_inr: 0,
    submitted_by: "self",
  };

  const { data: inserted, error: insErr } = await svc
    .from("registrations")
    .insert(insertRow)
    .select("id, public_token")
    .single();
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Always create a pending payment row when the event charges a non-zero
  // fee, regardless of whether the athlete pays online (UPI proof) or at
  // the venue counter. The row is the operator's handle: without it the
  // Registrations console has no way to mark "cash collected" for offline
  // events. The `method` defaults to the event's preferred channel; the
  // operator can flip it later via /api/admin/payments/[id]/collect.
  const fee = event.entry_fee_default_inr ?? 0;
  const mode = (event.payment_mode as "online_upi" | "offline" | "hybrid" | null) ?? "online_upi";
  if (fee > 0) {
    const { error: payErr } = await svc.from("payments").insert({
      registration_id: inserted.id,
      amount_inr: fee,
      method: mode === "offline" ? "cash" : "manual_upi",
      status: "pending",
    });
    if (payErr) {
      // Non-fatal — registration is already in. Surface a soft warning header
      // so the UI can still redirect; the proof form will appear on retry.
      console.error("payment row insert failed", payErr);
    }
  }

  await recordAudit({
    eventId: event.id,
    actorId: user.id,
    actorLabel: body.full_name,
    action: "registration.submit",
    targetTable: "registrations",
    targetId: inserted.id,
    payload: {
      gender: body.gender,
      nonpara_classes: nonpara,
      nonpara_hands: nonparaHandsArr,
      para_codes: para,
      para_hand: body.para_hand,
      declared_weight_kg: body.declared_weight_kg,
    },
  });

  return NextResponse.json({ public_token: inserted.public_token }, { status: 201 });
}
import { NextRequest, NextResponse } from "next/server";
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

interface PatchBody {
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
  nonpara_hands?: Record<string, Hand>;
  include_senior?: boolean;
  para_codes: string[];
  para_hand?: Hand;
}

function validateShape(b: unknown): b is PatchBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
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

/**
 * Athlete edit. Owner only, only while registration window is open AND
 * payment is not yet verified AND status is still pending/paid (never
 * weighed_in/disqualified/withdrawn).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
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

  const { data: reg } = await svc
    .from("registrations")
    .select(
      "id, public_token, event_id, athlete_id, status, lifecycle_status, discipline_status"
    )
    .eq("public_token", token)
    .maybeSingle();
  if (!reg) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (reg.athlete_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (
    reg.lifecycle_status === "withdrawn" ||
    reg.discipline_status === "disqualified" ||
    // Tolerate pre-0039 rows that only have the legacy mirror.
    reg.status === "withdrawn" ||
    reg.status === "disqualified"
  ) {
    return NextResponse.json(
      {
        error: `cannot edit after ${
          reg.discipline_status === "disqualified" || reg.status === "disqualified"
            ? "disqualified"
            : "withdrawn"
        }`,
      },
      { status: 409 }
    );
  }

  // Mirror the page-side guard: once accounts has signed off on any
  // payment for this registration, the row is immutable for the athlete.
  const { data: verifiedPay } = await svc
    .from("payments")
    .select("id")
    .eq("registration_id", reg.id)
    .eq("status", "verified")
    .limit(1)
    .maybeSingle();
  if (verifiedPay) {
    return NextResponse.json(
      { error: "cannot edit after payment is verified" },
      { status: 409 }
    );
  }

  const { data: event } = await svc
    .from("events")
    .select(
      "id, slug, starts_at, registration_published_at, registration_closed_at, status"
    )
    .eq("id", reg.event_id)
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

  // Mirror profile/athlete updates so the athlete record stays consistent.
  await svc
    .from("profiles")
    .update({ full_name: body.full_name, phone: body.mobile })
    .eq("id", user.id);
  await svc
    .from("athletes")
    .update({
      date_of_birth: body.dob,
      gender: body.gender,
      district: district ?? null,
      aadhaar_masked: aadhaarMasked,
    })
    .eq("id", user.id);

  const patchRow = {
    weight_class_code: backCompatCode,
    hand: nonparaHandsArr[0] ?? body.para_hand ?? "right",
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
  };

  const { error: updErr } = await svc
    .from("registrations")
    .update(patchRow)
    .eq("id", reg.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await recordAudit({
    eventId: event.id,
    actorId: user.id,
    actorLabel: body.full_name,
    action: "registration.edit",
    targetTable: "registrations",
    targetId: reg.id,
    payload: {
      gender: body.gender,
      nonpara_classes: nonpara,
      nonpara_hands: nonparaHandsArr,
      para_codes: para,
      para_hand: body.para_hand,
      declared_weight_kg: body.declared_weight_kg,
    },
  });

  return NextResponse.json({ ok: true, public_token: token });
}

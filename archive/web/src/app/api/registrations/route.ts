import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { compressImage, ImageError } from "@/lib/image";
import { putObject, keys } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import { bandsForDob } from "@/lib/rules/age-bands";
import { isTnDistrict } from "@/lib/rules/tn-districts";
import { paraPostureFor } from "@/lib/rules/para";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegBody = {
  event_slug: string;
  initial: string;
  full_name: string;
  dob: string; // yyyy-mm-dd
  gender: "M" | "F";
  division: "Men" | "Women" | "Para Men" | "Para Women";
  affiliation_kind: "District" | "Team";
  district?: string;
  team?: string;
  mobile: string;
  aadhaar_masked?: string;
  declared_weight_kg: number;
  youth_hand?: "L" | "R" | "B";
  senior_hand?: "L" | "R" | "B";
  is_para?: boolean;
  para_class?: string;
  para_posture?: "Standing" | "Seated";
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Expected multipart/form-data");
  }

  const raw = Object.fromEntries(form.entries());
  const photo = form.get("photo");
  if (!(photo instanceof Blob)) return bad("photo file is required");

  const body: RegBody = {
    event_slug: String(raw.event_slug ?? ""),
    initial: String(raw.initial ?? "").trim().toUpperCase().slice(0, 5),
    full_name: String(raw.full_name ?? "").trim().toUpperCase(),
    dob: String(raw.dob ?? ""),
    gender: (String(raw.gender ?? "") as RegBody["gender"]) || "M",
    division: (String(raw.division ?? "Men") as RegBody["division"]),
    affiliation_kind: (String(raw.affiliation_kind ?? "District") as RegBody["affiliation_kind"]),
    district: raw.district ? String(raw.district).toUpperCase() : undefined,
    team: raw.team ? String(raw.team).trim() : undefined,
    mobile: String(raw.mobile ?? "").trim(),
    aadhaar_masked: raw.aadhaar_masked ? String(raw.aadhaar_masked).trim() : undefined,
    declared_weight_kg: Number(raw.declared_weight_kg ?? 0),
    youth_hand: raw.youth_hand ? (String(raw.youth_hand) as "L" | "R" | "B") : undefined,
    senior_hand: raw.senior_hand ? (String(raw.senior_hand) as "L" | "R" | "B") : undefined,
    is_para: String(raw.is_para ?? "false") === "true",
    para_class: raw.para_class ? String(raw.para_class) : undefined,
    para_posture: raw.para_posture
      ? (String(raw.para_posture) as "Standing" | "Seated")
      : undefined,
  };

  // ---- Validation ----
  if (!body.full_name) return bad("Full name required");
  if (!body.initial) return bad("Initial required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dob)) return bad("DOB must be yyyy-mm-dd");
  if (!/^\+?\d{10,13}$/.test(body.mobile)) return bad("Mobile invalid");
  if (!(body.declared_weight_kg > 20 && body.declared_weight_kg < 250))
    return bad("Declared weight out of range");
  if (body.affiliation_kind === "District") {
    if (!body.district || !isTnDistrict(body.district)) return bad("Pick a valid TN district");
  } else if (!body.team) {
    return bad("Team name required");
  }
  if (body.is_para) {
    if (!body.para_class) return bad("Para class required");
    const inferred = paraPostureFor(
      body.para_class as Parameters<typeof paraPostureFor>[0]
    );
    if (!body.para_posture) {
      if (!inferred) return bad("Para posture required");
      body.para_posture = inferred;
    }
  }

  const admin = createAdminClient();

  // Look up event (must be published & open).
  const { data: event, error: evErr } = await admin
    .from("events")
    .select(
      "id, slug, status, registration_published_at, registration_closed_at, entry_fee_default_inr"
    )
    .eq("slug", body.event_slug)
    .maybeSingle();
  if (evErr || !event) return bad("Event not found", 404);
  if (!event.registration_published_at) return bad("Registration not open", 403);
  if (event.registration_closed_at) return bad("Registration closed", 403);

  // Derive age bands from DOB on event start (use today as fallback).
  const ageBands = bandsForDob(new Date(body.dob));

  // Allocate chest_no via SQL function.
  const { data: chestData, error: chestErr } = await admin.rpc("next_chest_no", {
    p_event_id: event.id,
  });
  if (chestErr || typeof chestData !== "number") {
    console.error("next_chest_no failed", chestErr);
    return bad("Could not allocate chest no", 500);
  }
  const chestNo = chestData;

  // Insert registration row (photo_url filled after upload).
  const { data: reg, error: insErr } = await admin
    .from("registrations")
    .insert({
      event_id: event.id,
      athlete_id: null,
      chest_no: chestNo,
      initial: body.initial,
      full_name: body.full_name,
      dob: body.dob,
      gender: body.gender,
      division: body.division,
      affiliation_kind: body.affiliation_kind,
      district: body.district ?? null,
      team: body.team ?? null,
      mobile: body.mobile,
      aadhaar_masked: body.aadhaar_masked ?? null,
      declared_weight_kg: body.declared_weight_kg,
      age_categories: ageBands,
      youth_hand: body.youth_hand ?? null,
      senior_hand: body.senior_hand ?? null,
      is_para: body.is_para ?? false,
      para_class: body.para_class ?? null,
      para_posture: body.para_posture ?? null,
      status: "pending",
      submitted_by: "self",
    })
    .select("id")
    .single();
  if (insErr || !reg) {
    console.error("registration insert failed", insErr);
    return bad("Could not create registration", 500);
  }

  // Compress + upload photo.
  let photoKey: string | null = null;
  let photoBytes = 0;
  try {
    const buf = Buffer.from(await photo.arrayBuffer());
    const compressed = await compressImage(buf, "photo");
    photoKey = keys.registrationPhoto(event.slug, reg.id);
    await putObject({
      bucket: "private",
      key: photoKey,
      body: compressed.buffer,
      contentType: compressed.contentType,
      cacheControl: "private, max-age=31536000, immutable",
    });
    photoBytes = compressed.bytes;
  } catch (err) {
    // Roll back the registration row — no orphan rows.
    await admin.from("registrations").delete().eq("id", reg.id);
    if (err instanceof ImageError) return bad(err.message, 400);
    console.error("photo upload failed", err);
    return bad("Photo upload failed", 500);
  }

  // Persist photo info on the row.
  await admin
    .from("registrations")
    .update({ photo_url: photoKey, photo_bytes: photoBytes })
    .eq("id", reg.id);

  // Create pending payment row for the entry fee.
  const fee = event.entry_fee_default_inr ?? 0;
  const { data: pay } = await admin
    .from("payments")
    .insert({
      registration_id: reg.id,
      amount_inr: fee,
      method: "manual_upi",
      status: "pending",
    })
    .select("id")
    .single();

  await recordAudit({
    action: "registration.create",
    eventId: event.id,
    actorLabel: `public:${body.mobile}`,
    targetTable: "registrations",
    targetId: reg.id,
    payload: {
      chest_no: chestNo,
      division: body.division,
      is_para: body.is_para ?? false,
      payment_id: pay?.id ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    registration_id: reg.id,
    chest_no: chestNo,
    payment_id: pay?.id ?? null,
    next: `/e/${event.slug}/thank-you/${chestNo}`,
  });
}

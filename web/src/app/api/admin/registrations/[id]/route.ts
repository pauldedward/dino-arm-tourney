import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET a registration as a bulk-row payload. Operator+ only.
 *
 * Used by the counter desk's Edit flow to hydrate the form when a
 * row was loaded from the server (no in-memory payload). Shape mirrors
 * the body accepted by /api/admin/registrations/bulk-row so the desk
 * can re-submit it after the operator's edits.
 *
 * PII handling — Aadhaar:
 *   - By default the response carries only `aadhaar_masked` ("XXXX-XXXX-1234").
 *   - The unmasked 12-digit value is returned ONLY when the caller passes
 *     `?reveal=aadhaar`. Each reveal is audit-logged with the actor.
 *   - Response is `Cache-Control: no-store` so the value is never stored
 *     in browser/CDN caches.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("operator", "/admin");
  const reveal = new URL(req.url).searchParams.get("reveal") === "aadhaar";

  const svc = createServiceClient();
  const { data: reg, error } = await svc
    .from("registrations")
    .select(
      `id, event_id, full_name, initial, dob, gender, affiliation_kind,
       district, team, mobile, aadhaar, aadhaar_masked, declared_weight_kg,
       nonpara_classes, nonpara_hand, nonpara_hands, age_categories,
       is_para, para_codes, para_hand, photo_url, photo_bytes,
       paid_amount_inr, status, chest_no, athlete_id, channel,
       payments(amount_inr, status, method, utr, proof_url)`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!reg) return NextResponse.json({ error: "not found" }, { status: 404 });

  const pay = Array.isArray(reg.payments) ? reg.payments[0] ?? null : null;

  // Reconstruct nonpara_hands map: prefer the per-class array if present,
  // else fall back to the single nonpara_hand applied to every selected class.
  const classes: string[] = (reg.nonpara_classes as string[] | null) ?? [];
  const handsArr = (reg.nonpara_hands as string[] | null) ?? null;
  const fallbackHand = (reg.nonpara_hand as string | null) ?? null;
  const nonparaHands: Record<string, string> = {};
  classes.forEach((c, i) => {
    const h = handsArr?.[i] ?? fallbackHand;
    if (h) nonparaHands[c] = h;
  });

  // Aadhaar: only fetch the unmasked value when the caller explicitly
  // asks. Audit every reveal so we have a paper trail.
  let aadhaarFull: string | null = null;
  if (reveal) {
    aadhaarFull = (reg.aadhaar as string | null) ?? null;
    if (!aadhaarFull && reg.athlete_id) {
      const { data: ath } = await svc
        .from("athletes")
        .select("aadhaar")
        .eq("id", reg.athlete_id as string)
        .maybeSingle();
      aadhaarFull = (ath?.aadhaar as string | null) ?? null;
    }
    await recordAudit({
      eventId: reg.event_id as string,
      actorId: session.userId,
      actorLabel: session.fullName ?? session.email,
      action: "registration.aadhaar.reveal",
      targetTable: "registrations",
      targetId: id,
      payload: { has_value: !!aadhaarFull },
    });
  }

  const payload = {
    event_id: reg.event_id,
    full_name: reg.full_name ?? "",
    initial: reg.initial ?? "",
    dob: reg.dob ?? "",
    gender: reg.gender ?? "M",
    affiliation_kind: reg.affiliation_kind ?? "District",
    district: reg.district ?? "",
    team: reg.team ?? "",
    mobile: reg.mobile ?? "",
    aadhaar: aadhaarFull ?? "",
    aadhaar_masked: reg.aadhaar_masked ?? null,
    declared_weight_kg: reg.declared_weight_kg ?? 0,
    nonpara_classes: classes,
    nonpara_hands: nonparaHands,
    include_senior:
      classes.includes("SENIOR") && classes.some((c) => c !== "SENIOR"),
    para_codes: (reg.para_codes as string[] | null) ?? [],
    para_hand: reg.para_hand ?? null,
    photo_key: reg.photo_url ?? null,
    photo_bytes: reg.photo_bytes ?? null,
    paid_amount_inr: pay?.amount_inr ?? reg.paid_amount_inr ?? 0,
    payment_status: pay?.status ?? "pending",
    payment_method: pay?.method ?? null,
    payment_utr: pay?.utr ?? "",
    payment_proof_key: pay?.proof_url ?? null,
    approve_weighin: reg.status === "weighed_in",
    channel: (reg.channel as "online" | "offline" | null) ?? "offline",
  };

  return NextResponse.json(
    { payload, chest_no: reg.chest_no },
    {
      headers: {
        // PII response — never cache, never share, never store.
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "Pragma": "no-cache",
        "Referrer-Policy": "no-referrer",
      },
    }
  );
}

/**
 * DELETE a registration. Operator+ only. Cascades to payments, weighins,
 * matches FKs (on delete cascade in 0003_week1.sql).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("operator", "/admin");

  const svc = createServiceClient();
  const { data: existing } = await svc
    .from("registrations")
    .select("id, event_id, full_name, chest_no, athlete_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "registration not found" }, { status: 404 });
  }

  const { error } = await svc.from("registrations").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordAudit({
    eventId: existing.event_id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "registration.delete",
    targetTable: "registrations",
    targetId: id,
    payload: {
      full_name: existing.full_name,
      chest_no: existing.chest_no,
      athlete_id: existing.athlete_id,
      prior_status: existing.status,
    },
  });

  return NextResponse.json({ ok: true });
}

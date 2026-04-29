import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";
import {
  validateRegistration,
  deriveDivision,
  nonParaCategory,
  paraCategory,
  type Hand,
} from "@/lib/rules/registration-rules";
import { wafBucketForWeight } from "@/lib/rules/waf-2025";
import type { WeightOverride } from "@/lib/rules/resolve";
import { sanitizeOverrides } from "@/lib/rules/resolve";
import { signedUrl } from "@/lib/storage";

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
       is_para, para_codes, para_hand, weight_overrides, photo_url, photo_bytes,
       paid_amount_inr, status, lifecycle_status, discipline_status,
       checkin_status, chest_no, athlete_id, channel,
       events(starts_at),
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
    event_starts_at:
      (reg as { events?: { starts_at?: string } | null }).events?.starts_at ?? null,
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
    weight_overrides: (reg.weight_overrides as unknown[]) ?? [],
    photo_key: reg.photo_url ?? null,
    photo_signed_url: reg.photo_url
      ? await signedUrl(reg.photo_url as string, 300).catch(() => null)
      : null,
    photo_bytes: reg.photo_bytes ?? null,
    paid_amount_inr: pay?.amount_inr ?? reg.paid_amount_inr ?? 0,
    payment_status: pay?.status ?? "pending",
    payment_method: pay?.method ?? null,
    payment_utr: pay?.utr ?? "",
    payment_proof_key: pay?.proof_url ?? null,
    approve_weighin: reg.checkin_status === "weighed_in",
    channel: (reg.channel as "online" | "offline" | null) ?? "offline",
    lifecycle_status:
      (reg.lifecycle_status as "active" | "withdrawn" | null) ?? "active",
    discipline_status:
      (reg.discipline_status as "clear" | "disqualified" | null) ?? "clear",
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

/**
 * PATCH a registration. Operator+ only.
 *
 * Used by the registrations table's pencil-icon edit modal to fix
 * typos and small mistakes without re-running the full intake flow.
 * The body is a strict allow-list — anything not enumerated below is
 * silently ignored. Aadhaar, photo, payment, and lifecycle fields all
 * have their own dedicated endpoints and are NOT editable here.
 *
 * On success the response shape mirrors the GET payload (so the caller
 * can update its local SavedRow without a refetch). Every accepted
 * change is collapsed into a single `registration.edit` audit entry
 * with the old→new diff, so the audit log shows what an operator
 * actually changed in this one click.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireRole("operator", "/admin");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const svc = createServiceClient();

  // Pull the current row so we can compute a meaningful diff and
  // re-run the rules engine over the merged state. We need the event
  // start date for the rules call (age-based eligibility is computed
  // against match day, not request time).
  const { data: existing, error: getErr } = await svc
    .from("registrations")
    .select(
      `id, event_id, full_name, initial, dob, gender, affiliation_kind,
       district, team, mobile, declared_weight_kg, weight_overrides,
       nonpara_classes, nonpara_hand, nonpara_hands, age_categories,
       is_para, para_codes, para_hand, para_class, division,
       weight_class_code, hand, channel, status, photo_url`,
    )
    .eq("id", id)
    .maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: ev } = await svc
    .from("events")
    .select("id, starts_at")
    .eq("id", existing.event_id as string)
    .single();
  if (!ev) return NextResponse.json({ error: "event missing" }, { status: 500 });

  // ---- Allow-list ----------------------------------------------------
  // Each entry: name | type-coercion | basic length/range validation.
  // Unknown keys are silently dropped — the modal MUST resend the
  // whole subset of editable fields, the route does not do partial
  // PATCH inside an array (e.g. para_codes[0]).
  type Patch = {
    full_name?: string;
    initial?: string | null;
    dob?: string;
    gender?: "M" | "F";
    mobile?: string;
    affiliation_kind?: "District" | "Team";
    district?: string | null;
    team?: string | null;
    declared_weight_kg?: number;
    weight_overrides?: WeightOverride[];
    channel?: "online" | "offline";
    nonpara_classes?: string[];
    nonpara_hands?: Record<string, Hand>;
    para_codes?: string[];
    para_hand?: Hand | null;
    // Lifecycle / discipline (post-0039). Each axis is independent and
    // overwrites blindly when present — the operator UI must show the
    // current value before letting them flip it.
    lifecycle_status?: "active" | "withdrawn";
    discipline_status?: "clear" | "disqualified";
    // Storage key returned by /api/upload (purpose=reg-photo). The route
    // never reads bytes — it stores the key the operator just uploaded
    // verbatim in `registrations.photo_url`. Pass `null` to clear.
    photo_key?: string | null;
  };
  const patch: Patch = {};
  if (typeof body.full_name === "string") patch.full_name = body.full_name.trim().slice(0, 120);
  if (typeof body.initial === "string")
    patch.initial = body.initial.trim().slice(0, 16) || null;
  if (body.initial === null) patch.initial = null;
  if (typeof body.dob === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dob)) patch.dob = body.dob;
  if (body.gender === "M" || body.gender === "F") patch.gender = body.gender;
  if (typeof body.mobile === "string") patch.mobile = body.mobile.replace(/\D/g, "").slice(0, 15);
  if (body.affiliation_kind === "District" || body.affiliation_kind === "Team")
    patch.affiliation_kind = body.affiliation_kind;
  if (typeof body.district === "string")
    patch.district = body.district.trim().slice(0, 80) || null;
  if (body.district === null) patch.district = null;
  if (typeof body.team === "string") patch.team = body.team.trim().slice(0, 120) || null;
  if (body.team === null) patch.team = null;
  if (typeof body.declared_weight_kg === "number" && Number.isFinite(body.declared_weight_kg)) {
    patch.declared_weight_kg = Math.max(20, Math.min(250, body.declared_weight_kg));
  }
  if (Array.isArray(body.weight_overrides))
    patch.weight_overrides = sanitizeOverrides(body.weight_overrides);
  if (body.channel === "online" || body.channel === "offline") patch.channel = body.channel;
  if (Array.isArray(body.nonpara_classes))
    patch.nonpara_classes = body.nonpara_classes.filter((c): c is string => typeof c === "string");
  if (body.nonpara_hands && typeof body.nonpara_hands === "object")
    patch.nonpara_hands = body.nonpara_hands as Record<string, Hand>;
  if (Array.isArray(body.para_codes))
    patch.para_codes = body.para_codes.filter((c): c is string => typeof c === "string");
  if (typeof body.para_hand === "string" || body.para_hand === null)
    patch.para_hand = body.para_hand as Hand | null;
  if (typeof body.photo_key === "string" || body.photo_key === null)
    patch.photo_key = body.photo_key;
  if (body.lifecycle_status === "active" || body.lifecycle_status === "withdrawn")
    patch.lifecycle_status = body.lifecycle_status;
  if (body.discipline_status === "clear" || body.discipline_status === "disqualified")
    patch.discipline_status = body.discipline_status;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields" }, { status: 400 });
  }

  // ---- Re-run rules engine over the MERGED state --------------------
  // We don't trust a partial PATCH to be self-consistent: classes/hands/
  // weight/gender/dob are tightly coupled (e.g. switching to a para
  // code requires a para_hand). Merge the patch onto the existing row
  // and validate the whole thing.
  const merged = {
    gender: (patch.gender ?? existing.gender) as "M" | "F",
    dob: (patch.dob ?? existing.dob) as string,
    declaredWeightKg: (patch.declared_weight_kg ??
      (existing.declared_weight_kg as number)) as number,
    nonparaClasses: (patch.nonpara_classes ??
      ((existing.nonpara_classes as string[] | null) ?? [])) as string[],
    nonparaHands: ((): Record<string, Hand> => {
      if (patch.nonpara_hands) return patch.nonpara_hands;
      // Reconstruct from existing arrays (mirrors GET handler logic).
      const cls = ((existing.nonpara_classes as string[] | null) ?? []) as string[];
      const arr = (existing.nonpara_hands as string[] | null) ?? null;
      const fb = (existing.nonpara_hand as string | null) ?? null;
      const out: Record<string, Hand> = {};
      cls.forEach((c, i) => {
        const h = (arr?.[i] ?? fb) as Hand | null;
        if (h) out[c] = h;
      });
      return out;
    })(),
    includeSenior: false, // not an editable concept post-intake
    paraCodes: (patch.para_codes ?? ((existing.para_codes as string[] | null) ?? [])) as string[],
    paraHand: (patch.para_hand ?? ((existing.para_hand as Hand | null) ?? null)) as Hand | null,
  };
  const v = validateRegistration(merged, ev.starts_at as string);
  if (!v.ok) {
    return NextResponse.json({ error: v.errors.join("; ") }, { status: 400 });
  }

  const nonpara = v.effectiveNonPara;
  const para = v.effectivePara;
  const nonparaHandsArr = nonpara.map((c) => v.effectiveNonParaHands[c]);
  const division = deriveDivision(merged.gender, nonpara.length > 0, para.length > 0);
  let backCompatCode = (existing.weight_class_code as string | null) ?? "UNK";
  if (nonpara.length > 0) {
    const cat = nonParaCategory(nonpara[0], merged.gender);
    const b = cat ? wafBucketForWeight(cat, merged.declaredWeightKg) : null;
    if (b) backCompatCode = b.code;
  } else if (para.length > 0) {
    const cat = paraCategory(para[0]);
    const b = cat ? wafBucketForWeight(cat, merged.declaredWeightKg) : null;
    if (b) backCompatCode = b.code;
  }

  // Build the row update. Only set fields that actually changed (so the
  // diff in the audit log is honest), but always recompute the derived
  // columns when any of their inputs moved.
  const update: Record<string, unknown> = {};
  if (patch.full_name !== undefined) update.full_name = patch.full_name;
  if (patch.initial !== undefined) update.initial = patch.initial;
  if (patch.dob !== undefined) update.dob = patch.dob;
  if (patch.gender !== undefined) update.gender = patch.gender;
  if (patch.mobile !== undefined) update.mobile = patch.mobile;
  if (patch.affiliation_kind !== undefined) update.affiliation_kind = patch.affiliation_kind;
  if (patch.district !== undefined) update.district = patch.district;
  if (patch.team !== undefined) update.team = patch.team;
  if (patch.declared_weight_kg !== undefined)
    update.declared_weight_kg = patch.declared_weight_kg;
  if (patch.weight_overrides !== undefined) update.weight_overrides = patch.weight_overrides;
  if (patch.channel !== undefined) update.channel = patch.channel;
  if (patch.photo_key !== undefined) update.photo_url = patch.photo_key;
  if (patch.lifecycle_status !== undefined)
    update.lifecycle_status = patch.lifecycle_status;
  if (patch.discipline_status !== undefined)
    update.discipline_status = patch.discipline_status;
  if (
    patch.nonpara_classes !== undefined ||
    patch.nonpara_hands !== undefined ||
    patch.para_codes !== undefined ||
    patch.para_hand !== undefined ||
    patch.gender !== undefined ||
    patch.declared_weight_kg !== undefined
  ) {
    update.nonpara_classes = nonpara;
    update.nonpara_hand = nonparaHandsArr[0] ?? null;
    update.nonpara_hands = nonparaHandsArr.length > 0 ? nonparaHandsArr : null;
    update.age_categories = nonpara;
    update.para_codes = para;
    update.para_class = para.length > 0 ? para[0] : null;
    update.para_hand = para.length > 0 ? merged.paraHand ?? null : null;
    update.is_para = para.length > 0;
    update.division = division;
    update.weight_class_code = backCompatCode;
    update.hand = nonparaHandsArr[0] ?? merged.paraHand ?? "right";
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { error: upErr } = await svc
    .from("registrations")
    .update(update)
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Build a compact diff for the audit payload. Photo bytes/keys are
  // collapsed to a boolean — the audit log shouldn't carry storage URLs.
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(update)) {
    const before = (existing as Record<string, unknown>)[k];
    const after = update[k];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      if (k === "photo_url") {
        diff[k] = { from: !!before, to: !!after };
      } else {
        diff[k] = { from: before, to: after };
      }
    }
  }
  await recordAudit({
    eventId: existing.event_id as string,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "registration.edit",
    targetTable: "registrations",
    targetId: id,
    payload: { fields: Object.keys(diff), diff },
  });

  return NextResponse.json(
    { ok: true, fields: Object.keys(diff) },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "Pragma": "no-cache",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

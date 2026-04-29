import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { compressImage, ImageRejectedError } from "@/lib/image";
import { putObject, mediaKey } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import { isPaid } from "@/lib/payments/status";
import { sanitizeOverrides } from "@/lib/rules/resolve";

export const runtime = "nodejs";

/**
 * POST /api/weighin
 *
 * Multipart:
 *   - registration_id  required
 *   - measured_kg      required
 *   - file             optional JPEG blob — scale / weight-proof photo,
 *                      stored on `weigh_ins.live_photo_url`
 *   - athlete_file     optional JPEG blob — replaces the athlete photo
 *                      on `registrations.photo_url` (last write wins).
 *
 * Compresses photos if present, uploads to private R2, then inserts
 * a weigh_ins row and flips the registration to `weighed_in`. This is
 * additive — multiple re-weighs are allowed; the latest row wins when
 * the resolver picks a weight class. Either or both photos may be
 * omitted — the weight is the only mandatory artefact.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole("operator", "/admin/events");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart" }, { status: 400 });
  }

  const registrationId = String(form.get("registration_id") ?? "");
  const measuredRaw = String(form.get("measured_kg") ?? "");
  const measured = Number(measuredRaw);
  const file = form.get("file");
  const athleteFile = form.get("athlete_file");
  // Optional operator picks: per-entry weight class overrides. JSON
  // string in the form field. Missing/empty means "don't touch".
  const overridesRaw = form.get("weight_overrides");
  const weightOverrides: unknown =
    overridesRaw === null || overridesRaw === undefined || String(overridesRaw) === ""
      ? null
      : (() => {
          try {
            return JSON.parse(String(overridesRaw));
          } catch {
            return null;
          }
        })();

  if (!registrationId) {
    return NextResponse.json({ error: "registration_id required" }, { status: 400 });
  }
  if (!Number.isFinite(measured) || measured < 20 || measured > 250) {
    return NextResponse.json(
      { error: "measured_kg must be between 20 and 250" },
      { status: 400 }
    );
  }

  const svc = createServiceClient();
  const { data: reg } = await svc
    .from("registrations")
    .select("id, event_id, status, is_para, weight_overrides, payments(status)")
    .eq("id", registrationId)
    .maybeSingle();
  if (!reg) {
    return NextResponse.json({ error: "registration not found" }, { status: 404 });
  }

  let livePhotoUrl: string | null = null;

  if (file instanceof File && file.size > 0) {
    try {
      const raw = Buffer.from(await file.arrayBuffer());
      const compressed = await compressImage(raw, file.type || "image/jpeg");
      const key = mediaKey(reg.event_id, "weigh-in", randomUUID());
      const put = await putObject("private", key, compressed.buffer, compressed.contentType);
      livePhotoUrl = put.publicUrl ?? put.key;
    } catch (err) {
      if (err instanceof ImageRejectedError) {
        return NextResponse.json({ error: err.message }, { status: 415 });
      }
      console.error("[weighin] photo upload failed", err);
      // Non-fatal: continue without photo. The weight is more important.
    }
  }

  // Athlete photo — separate upload, replaces registrations.photo_url.
  let athletePhotoKey: string | null = null;
  let athletePhotoBytes: number | null = null;
  if (athleteFile instanceof File && athleteFile.size > 0) {
    try {
      const raw = Buffer.from(await athleteFile.arrayBuffer());
      const compressed = await compressImage(raw, athleteFile.type || "image/jpeg");
      const key = mediaKey(reg.event_id, "reg-photo", randomUUID());
      await putObject("private", key, compressed.buffer, compressed.contentType);
      athletePhotoKey = key;
      athletePhotoBytes = compressed.bytes;
    } catch (err) {
      if (err instanceof ImageRejectedError) {
        return NextResponse.json({ error: err.message }, { status: 415 });
      }
      console.error("[weighin] athlete photo upload failed", err);
      // Non-fatal: weight is the priority.
    }
  }

  const { data: inserted, error } = await svc
    .from("weigh_ins")
    .insert({
      registration_id: registrationId,
      measured_kg: measured,
      live_photo_url: livePhotoUrl,
      weighed_by: session.userId,
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If a fresh athlete photo was captured at the table, replace the
  // canonical photo on file. Last write wins — the most recent face is
  // what shows up on ID cards, brackets, and the operator's roster.
  // Note: the scale/weight-proof photo (`file` → live_photo_url) is NOT
  // copied here; only the explicit `athlete_file` updates the registration.
  if (athletePhotoKey) {
    await svc
      .from("registrations")
      .update({ photo_url: athletePhotoKey, photo_bytes: athletePhotoBytes })
      .eq("id", registrationId);
  }

  // Persist the operator's per-entry weight overrides if supplied.
  // The resolver silently ignores any pick lighter than the auto bucket,
  // so we don't validate against weight here.
  let overridesChanged = false;
  if (Array.isArray(weightOverrides)) {
    const cleaned = sanitizeOverrides(weightOverrides);
    await svc
      .from("registrations")
      .update({ weight_overrides: cleaned })
      .eq("id", registrationId);
    overridesChanged = true;
  }

  // checkin_status is maintained by the trigger on weigh_ins (0029).
  // Post-0039 we no longer mirror anything onto the deprecated
  // registrations.status column — the weigh-in fact lives on
  // checkin_status, and "paid" lives on payment_summary.derived_status.

  await recordAudit({
    eventId: reg.event_id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "weighin.record",
    targetTable: "weigh_ins",
    targetId: inserted.id,
    payload: {
      registration_id: registrationId,
      measured_kg: measured,
      ...(overridesChanged ? { weight_overrides_updated: true } : {}),
    },
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}

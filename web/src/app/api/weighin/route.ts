import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { compressImage, ImageRejectedError } from "@/lib/image";
import { putObject, mediaKey } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import { isPaid } from "@/lib/payments/status";

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
  // Optional non-para opt-in: when present, set/clear the persistent
  // bump-up flag on the registration as part of the same write so the
  // operator can change their mind at the scale.
  const bumpRaw = form.get("weight_bump_up");
  const weightBumpUp =
    bumpRaw === null || bumpRaw === undefined
      ? null
      : String(bumpRaw) === "true" || String(bumpRaw) === "1";

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
    .select("id, event_id, status, is_para, weight_bump_up, payments(status)")
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

  // Persist the bump-up toggle if the operator changed it at the scale.
  // No-op for para entries (silently ignored) and when the field wasn't
  // submitted at all so older clients keep working unchanged.
  let bumpChanged = false;
  if (weightBumpUp !== null && !reg.is_para && weightBumpUp !== reg.weight_bump_up) {
    await svc
      .from("registrations")
      .update({ weight_bump_up: weightBumpUp })
      .eq("id", registrationId);
    bumpChanged = true;
  }

  // Status machine: only flip paid → weighed_in. "Paid" is computed from
  // payments.status (with a legacy fallback to registrations.status) so the
  // weigh-in flow no longer drifts when the bulk-row writer skipped one of
  // the two writes. "Weighed" itself is derived from weigh_ins presence,
  // not from registrations.status.
  if (isPaid(reg.status, reg.payments ?? null)) {
    await svc
      .from("registrations")
      .update({ status: "weighed_in" })
      .eq("id", registrationId);
  }

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
      ...(bumpChanged ? { weight_bump_up: weightBumpUp } : {}),
    },
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}

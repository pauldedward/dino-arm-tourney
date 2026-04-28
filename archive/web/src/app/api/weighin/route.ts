import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isOperator } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { compressImage } from "@/lib/image";
import { putObject, keys } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sess = await getSession();
  if (!isOperator(sess.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const fd = await req.formData();
  const registrationId = String(fd.get("registration_id") ?? "");
  const measuredKg = Number(fd.get("measured_kg"));
  if (!registrationId || !Number.isFinite(measuredKg) || measuredKg < 20 || measuredKg > 250) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: reg } = await admin
    .from("registrations")
    .select("id, event_id, chest_no, events(slug)")
    .eq("id", registrationId)
    .maybeSingle();
  if (!reg) return NextResponse.json({ ok: false, error: "Registration not found" }, { status: 404 });

  let photoUrl: string | null = null;
  const photo = fd.get("photo") as File | null;
  if (photo && photo.size > 0) {
    try {
      const buf = Buffer.from(await photo.arrayBuffer());
      const compressed = await compressImage(buf, "photo");
      const slug = (reg as unknown as { events: { slug: string } }).events?.slug ?? "event";
      const key = keys.weighInPhoto(slug, registrationId, `${Date.now()}`);
      const { url } = await putObject({
        bucket: "public",
        key,
        body: compressed.buffer,
        contentType: compressed.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      });
      photoUrl = url ?? null;
    } catch {
      // Photo failure is non-fatal for weigh-in.
    }
  }

  const { data: ins, error } = await admin
    .from("weigh_ins")
    .insert({
      registration_id: registrationId,
      measured_kg: measuredKg,
      live_photo_url: photoUrl,
      weighed_by: sess.user!.id,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await admin.from("registrations").update({ status: "weighed_in" }).eq("id", registrationId);

  await recordAudit({
    action: "weighin.record",
    eventId: reg.event_id,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "weigh_ins",
    targetId: ins.id,
    payload: { measured_kg: measuredKg },
  });
  return NextResponse.json({ ok: true, weigh_in_id: ins.id });
}

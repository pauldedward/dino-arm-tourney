import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { compressImage, ImageRejectedError } from "@/lib/image";
import { putObject, mediaKey } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * POST /api/admin/registrations/[id]/photo
 *
 * Multipart:
 *   - file  required (JPEG/PNG/WebP/HEIC blob)
 *
 * Lets the weigh-in operator retake or attach an athlete photo without
 * recording another weigh-in. Replaces `registrations.photo_url` so the
 * latest capture is what ID cards and the roster show. Last write wins.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: registrationId } = await params;
  const session = await requireRole("operator", "/admin/events");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: reg } = await svc
    .from("registrations")
    .select("id, event_id")
    .eq("id", registrationId)
    .maybeSingle();
  if (!reg) {
    return NextResponse.json({ error: "registration not found" }, { status: 404 });
  }

  let key: string;
  let bytes: number;
  try {
    const raw = Buffer.from(await file.arrayBuffer());
    const compressed = await compressImage(raw, file.type || "image/jpeg");
    key = mediaKey(reg.event_id, "reg-photo", randomUUID());
    await putObject("private", key, compressed.buffer, compressed.contentType);
    bytes = compressed.bytes;
  } catch (err) {
    if (err instanceof ImageRejectedError) {
      return NextResponse.json({ error: err.message }, { status: 415 });
    }
    console.error("[reg-photo] upload failed", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }

  const { error: updErr } = await svc
    .from("registrations")
    .update({ photo_url: key, photo_bytes: bytes })
    .eq("id", registrationId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await recordAudit({
    eventId: reg.event_id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "registration.photo.update",
    targetTable: "registrations",
    targetId: registrationId,
    payload: { source: "weighin", bytes },
  });

  return NextResponse.json({ ok: true, photo_key: key, photo_bytes: bytes });
}

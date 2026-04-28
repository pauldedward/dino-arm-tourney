import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { compressImage, ImageError } from "@/lib/image";
import { putObject, keys } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const paymentId = String(form.get("payment_id") ?? "").trim();
  const utr = String(form.get("utr") ?? "").trim();
  const screenshot = form.get("screenshot");
  if (!paymentId) return bad("payment_id required");
  if (!utr) return bad("UTR required");
  if (!(screenshot instanceof Blob)) return bad("screenshot file required");

  const admin = createAdminClient();

  // Look up payment + parent registration + event slug for the storage key.
  const { data: payment, error: pErr } = await admin
    .from("payments")
    .select("id, status, registration_id, registrations(event_id, events(slug))")
    .eq("id", paymentId)
    .maybeSingle();
  if (pErr || !payment) return bad("Payment not found", 404);
  if (payment.status === "verified") return bad("Already verified", 409);

  // Type-narrow nested join.
  const reg = (payment as unknown as {
    registration_id: string;
    registrations: { event_id: string; events: { slug: string } } | null;
  }).registrations;
  if (!reg) return bad("Registration not found", 404);
  const eventSlug = reg.events.slug;
  const eventId = reg.event_id;

  // Compress + upload screenshot.
  let proofKey: string;
  try {
    const buf = Buffer.from(await screenshot.arrayBuffer());
    const compressed = await compressImage(buf, "screenshot");
    proofKey = keys.paymentProof(eventSlug, payment.registration_id, payment.id);
    await putObject({
      bucket: "private",
      key: proofKey,
      body: compressed.buffer,
      contentType: compressed.contentType,
      cacheControl: "private, max-age=31536000, immutable",
    });
  } catch (err) {
    if (err instanceof ImageError) return bad(err.message, 400);
    console.error("proof upload failed", err);
    return bad("Upload failed", 500);
  }

  // Update payment row.
  const { error: uErr } = await admin
    .from("payments")
    .update({
      utr,
      proof_url: proofKey,
      status: "submitted",
    })
    .eq("id", payment.id);
  if (uErr) {
    console.error("payment update failed", uErr);
    return bad("Could not save proof", 500);
  }

  await recordAudit({
    action: "payment.proof.submit",
    eventId,
    actorLabel: "public",
    targetTable: "payments",
    targetId: payment.id,
    payload: { utr, registration_id: payment.registration_id },
  });

  return NextResponse.json({ ok: true });
}

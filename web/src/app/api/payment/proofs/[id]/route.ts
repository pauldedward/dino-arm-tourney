import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase-server";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * DELETE /api/payment/proofs/[id]
 *
 * Athlete-owner deletes one of their submitted proofs. Blocked once the
 * parent payment is verified. After delete, mirror the new latest proof
 * (if any) back onto payments.utr / payments.proof_url; if none remain,
 * clear them so admin sees "no proof yet".
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  const { data: proof } = await svc
    .from("payment_proofs")
    .select(
      "id, payment_id, utr, payments!inner(id, status, registration_id, registrations!inner(athlete_id, event_id))"
    )
    .eq("id", id)
    .maybeSingle();
  if (!proof) {
    return NextResponse.json({ error: "proof not found" }, { status: 404 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payment = (proof as any).payments;
  const reg = payment?.registrations;
  if (!payment || !reg) {
    return NextResponse.json({ error: "payment not found" }, { status: 404 });
  }
  if (reg.athlete_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (payment.status === "verified") {
    return NextResponse.json(
      { error: "payment already verified" },
      { status: 409 }
    );
  }

  const { error: delErr } = await svc
    .from("payment_proofs")
    .delete()
    .eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Re-pick latest remaining proof for the mirror columns.
  const { data: latest } = await svc
    .from("payment_proofs")
    .select("utr, proof_url")
    .eq("payment_id", payment.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await svc
    .from("payments")
    .update({
      utr: latest?.utr ?? null,
      proof_url: latest?.proof_url ?? null,
    })
    .eq("id", payment.id);

  await recordAudit({
    eventId: reg.event_id,
    actorId: user.id,
    action: "payment.proof_deleted",
    targetTable: "payment_proofs",
    targetId: id,
    payload: { payment_id: payment.id, utr_tail: (proof.utr ?? "").slice(-4) },
  });

  return NextResponse.json({ ok: true });
}

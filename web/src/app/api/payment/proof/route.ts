import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface ProofBody {
  registration_id: string;
  utr: string;
  proof_key: string; // R2 key returned by /api/upload
}

/**
 * POST /api/payment/proof
 *
 * Public endpoint. Called from the thank-you page after the athlete pays
 * via UPI and uploads a screenshot. Attaches UTR + proof URL to the
 * pending payment and leaves status=pending until an operator verifies.
 */
export async function POST(req: Request) {
  let body: ProofBody;
  try {
    body = (await req.json()) as ProofBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.registration_id || !body.utr || !body.proof_key) {
    return NextResponse.json(
      { error: "registration_id, utr, proof_key are required" },
      { status: 400 }
    );
  }
  if (!/^\d{8,22}$/.test(body.utr.trim())) {
    return NextResponse.json({ error: "UTR must be 8-22 digits" }, { status: 400 });
  }

  const svc = createServiceClient();

  const { data: payment, error: payErr } = await svc
    .from("payments")
    .select("id, registration_id, status, registrations!inner(event_id)")
    .eq("registration_id", body.registration_id)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  if (payErr || !payment) {
    return NextResponse.json(
      { error: "no pending payment for this registration" },
      { status: 404 }
    );
  }

  const { error: updErr } = await svc
    .from("payments")
    .update({
      utr: body.utr.trim(),
      proof_url: body.proof_key,
    })
    .eq("id", payment.id);

  if (updErr) {
    console.error("[proof] update failed", updErr);
    return NextResponse.json({ error: "failed to attach proof" }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = (payment as any).registrations?.event_id ?? null;
  await recordAudit({
    eventId,
    actorLabel: "public",
    action: "payment.proof_submitted",
    targetTable: "payments",
    targetId: payment.id,
    payload: { utr_tail: body.utr.trim().slice(-4) },
  });

  return NextResponse.json({ ok: true });
}

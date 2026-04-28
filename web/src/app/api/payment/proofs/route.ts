import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase-server";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface ProofBody {
  registration_id: string;
  utr: string;
  proof_key: string; // R2 key returned by /api/upload
}

/**
 * POST /api/payment/proofs
 *
 * Athlete (owner) attaches a UTR + screenshot to their pending payment.
 * Multiple proofs allowed per payment until it's verified. Mirrors the
 * latest proof onto payments.utr / payments.proof_url so the existing
 * admin verification UI keeps working unchanged.
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
  const utr = body.utr.trim();
  if (!/^\d{8,22}$/.test(utr)) {
    return NextResponse.json({ error: "UTR must be 8-22 digits" }, { status: 400 });
  }

  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  const svc = createServiceClient();

  const { data: reg } = await svc
    .from("registrations")
    .select("id, athlete_id, event_id")
    .eq("id", body.registration_id)
    .maybeSingle();
  if (!reg) {
    return NextResponse.json({ error: "registration not found" }, { status: 404 });
  }
  // If the athlete is signed in, enforce ownership. Anonymous fallback is
  // allowed (legacy thank-you page flow uses public token).
  if (user && reg.athlete_id && user.id !== reg.athlete_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: payment } = await svc
    .from("payments")
    .select("id, status")
    .eq("registration_id", body.registration_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!payment) {
    return NextResponse.json(
      { error: "no payment row for this registration" },
      { status: 404 }
    );
  }
  if (payment.status === "verified") {
    return NextResponse.json(
      { error: "payment already verified" },
      { status: 409 }
    );
  }

  const { data: inserted, error: insErr } = await svc
    .from("payment_proofs")
    .insert({
      payment_id: payment.id,
      utr,
      proof_url: body.proof_key,
    })
    .select("id")
    .single();
  if (insErr) {
    console.error("[proofs] insert failed", insErr);
    return NextResponse.json({ error: "failed to attach proof" }, { status: 500 });
  }

  // Mirror latest onto payments + flip rejected back to pending so
  // admins re-review.
  await svc
    .from("payments")
    .update({
      utr,
      proof_url: body.proof_key,
      status: payment.status === "rejected" ? "pending" : payment.status,
    })
    .eq("id", payment.id);

  await recordAudit({
    eventId: reg.event_id,
    actorId: user?.id,
    actorLabel: user ? undefined : "public",
    action: "payment.proof_submitted",
    targetTable: "payment_proofs",
    targetId: inserted.id,
    payload: { utr_tail: utr.slice(-4), payment_id: payment.id },
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isOperator } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sess = await getSession();
  if (!isOperator(sess.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { payment_id } = (await req.json()) as { payment_id?: string };
  if (!payment_id) return NextResponse.json({ ok: false, error: "payment_id required" }, { status: 400 });

  const admin = createAdminClient();
  // Race-safe: only flip pending/submitted → verified once.
  const { data, error } = await admin
    .from("payments")
    .update({
      status: "verified",
      verified_by: sess.user!.id,
      verified_at: new Date().toISOString(),
    })
    .eq("id", payment_id)
    .in("status", ["pending", "submitted"])
    .select("id, registration_id")
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Already processed" }, { status: 409 });

  // Bump registration to 'paid' if currently pending.
  await admin
    .from("registrations")
    .update({ status: "paid" })
    .eq("id", data.registration_id)
    .eq("status", "pending");

  // Find event id for audit.
  const { data: reg } = await admin
    .from("registrations")
    .select("event_id")
    .eq("id", data.registration_id)
    .maybeSingle();

  await recordAudit({
    action: "payment.verify",
    eventId: reg?.event_id ?? null,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "payments",
    targetId: payment_id,
  });
  return NextResponse.json({ ok: true });
}

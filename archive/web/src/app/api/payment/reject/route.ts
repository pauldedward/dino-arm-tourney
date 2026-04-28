import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isOperator } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sess = await getSession();
  if (!isOperator(sess.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { payment_id, reason } = (await req.json()) as { payment_id?: string; reason?: string };
  if (!payment_id) return NextResponse.json({ ok: false, error: "payment_id required" }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payments")
    .update({ status: "rejected", notes: reason ?? null })
    .eq("id", payment_id)
    .in("status", ["pending", "submitted"])
    .select("id, registration_id")
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Already processed" }, { status: 409 });
  await recordAudit({
    action: "payment.reject",
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "payments",
    targetId: payment_id,
    payload: { reason: reason ?? null },
  });
  return NextResponse.json({ ok: true });
}

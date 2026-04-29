import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const { id, action } = await params;
  if (!["verify", "reject"].includes(action)) {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const session = await requireRole("operator", "/admin");

  const svc = createServiceClient();
  const { data: existing, error: selErr } = await svc
    .from("payments")
    .select(
      "id, registration_id, status, verified_by, verified_at, registrations!inner(event_id)"
    )
    .eq("id", id)
    .maybeSingle();
  if (selErr) {
    console.error("[payments/verify] select failed", selErr);
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "payment not found" }, { status: 404 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = (existing as any).registrations?.event_id ?? null;
  // Idempotent: if already resolved by someone else, no-op
  if (existing.status !== "pending") {
    return NextResponse.json({ ok: true, alreadyResolved: true });
  }

  const patch =
    action === "verify"
      ? {
          status: "verified",
          verified_by: session.userId,
          verified_at: new Date().toISOString(),
        }
      : { status: "rejected" };

  const { error } = await svc
    .from("payments")
    .update(patch)
    .eq("id", id)
    .eq("status", "pending"); // guard against race
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Post-0039: payment status is read from payment_summary.derived_status,
  // not from a mirror column on registrations. Nothing to mirror here.

  await recordAudit({
    eventId,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: `payment.${action}`,
    targetTable: "payments",
    targetId: id,
    payload: { registration_id: existing.registration_id },
  });

  return NextResponse.json({ ok: true });
}

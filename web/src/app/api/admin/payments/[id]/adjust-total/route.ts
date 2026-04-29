import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";
import {
  summarisePayment,
  type CollectionLike,
} from "@/lib/payments/collections";

export const runtime = "nodejs";

/**
 * POST /api/admin/payments/[id]/adjust-total
 *
 * Operator-only: change the total fee owed on a payment (e.g. category
 * was added/removed after the fact, or the operator typed the wrong
 * amount). Re-derives `payments.status` against existing collections
 * — raising the total may flip a previously-verified payment back to
 * `pending`, lowering it may auto-verify.
 *
 * Body:
 *   { amount_inr: number, reason?: string }
 */
interface Body {
  amount_inr?: unknown;
  reason?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("operator", "/admin");

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (
    typeof body.amount_inr !== "number" ||
    !Number.isFinite(body.amount_inr) ||
    body.amount_inr < 0
  ) {
    return NextResponse.json(
      { error: "amount_inr must be a non-negative number" },
      { status: 400 }
    );
  }
  const newAmount = Math.round(body.amount_inr);
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : null;

  const svc = createServiceClient();
  const { data: existing, error: selErr } = await svc
    .from("payments")
    .select(
      "id, registration_id, status, amount_inr, registrations!inner(event_id), payment_collections(amount_inr, reversed_at)"
    )
    .eq("id", id)
    .maybeSingle();
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "payment not found" }, { status: 404 });
  }

  const oldAmount = existing.amount_inr ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = (existing as any).registrations?.event_id ?? null;
  const collections =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((existing as any).payment_collections as CollectionLike[] | null) ?? [];
  const newSummary = summarisePayment(newAmount, collections);

  const patch: Record<string, unknown> = { amount_inr: newAmount };
  if (newSummary.fully_collected && existing.status !== "verified") {
    patch.status = "verified";
    patch.verified_by = session.userId;
    patch.verified_at = new Date().toISOString();
  } else if (!newSummary.fully_collected && existing.status === "verified") {
    patch.status = "pending";
    patch.verified_by = null;
    patch.verified_at = null;
  }

  const { error: updErr } = await svc.from("payments").update(patch).eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Post-0039: no mirror onto registrations.status.

  await recordAudit({
    eventId,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "payment.adjust_total",
    targetTable: "payments",
    targetId: id,
    payload: {
      registration_id: existing.registration_id,
      from_inr: oldAmount,
      to_inr: newAmount,
      reason,
      collected_inr: newSummary.collected_inr,
      now_verified: newSummary.fully_collected,
    },
  });

  return NextResponse.json({
    ok: true,
    amount_inr: newAmount,
    collected_inr: newSummary.collected_inr,
    remaining_inr: newSummary.remaining_inr,
    now_verified: newSummary.fully_collected,
  });
}

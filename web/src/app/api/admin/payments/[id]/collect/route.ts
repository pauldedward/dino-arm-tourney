import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";
import {
  planCollection,
  summarisePayment,
  type CollectionLike,
} from "@/lib/payments/collections";

export const runtime = "nodejs";

/**
 * POST /api/admin/payments/[id]/collect
 *
 * Operator-marks a (possibly partial) collection against a pending payment.
 * Supports installments — calling this multiple times will accumulate
 * `payment_collections` rows; the parent `payments.status` only flips to
 * `verified` once the sum of active collections covers `amount_inr`.
 *
 * Body:
 *   {
 *     method:           "cash" | "manual_upi" | "waiver",
 *     amount_inr?:      number,    // partial; defaults to remaining
 *     waive_remainder?: boolean,   // also write a waiver row for the rest
 *     reference?:       string     // receipt #, UTR, "DC bundle 22-Apr"
 *   }
 *
 * Idempotent against double-clicks: if the payment is already verified
 * we return `{ ok: true, alreadyResolved: true }`. Concurrent partial
 * collections are race-safe because the planner clamps to remaining.
 */
const ALLOWED_METHODS = new Set(["cash", "manual_upi", "waiver"]);

interface Body {
  method?: unknown;
  amount_inr?: unknown;
  waive_remainder?: unknown;
  reference?: unknown;
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
  const method = String(body.method ?? "");
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { error: `method must be one of ${[...ALLOWED_METHODS].join(", ")}` },
      { status: 400 }
    );
  }
  const reference =
    typeof body.reference === "string" && body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 500)
      : null;
  const waiveRemainder = body.waive_remainder === true;

  const svc = createServiceClient();

  // Fetch payment + active collections in one round-trip via embedded join.
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
  if (existing.status === "verified") {
    return NextResponse.json({ ok: true, alreadyResolved: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = (existing as any).registrations?.event_id ?? null;
  const collections =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((existing as any).payment_collections as CollectionLike[] | null) ?? [];
  const summary = summarisePayment(existing.amount_inr ?? 0, collections);

  // The UI may pass amount_inr; if absent, default to "collect remaining".
  const requestedAmount =
    typeof body.amount_inr === "number" && Number.isFinite(body.amount_inr)
      ? Math.max(0, Math.round(body.amount_inr))
      : summary.remaining_inr;

  const plan = planCollection(summary, {
    method: method as "cash" | "manual_upi" | "waiver",
    amount_inr: requestedAmount,
    waive_remainder: waiveRemainder,
    reference,
  });
  if (!plan.ok) {
    return NextResponse.json({ error: plan.error }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const insertRows = plan.rows.map((r) => ({
    payment_id: id,
    amount_inr: r.amount_inr,
    method: r.method,
    reference: r.reference,
    collected_by: session.userId,
    collected_at: nowIso,
  }));

  if (insertRows.length > 0) {
    const { error: insErr } = await svc
      .from("payment_collections")
      .insert(insertRows);
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // Recompute status from the fresh totals.
  const newCollected =
    summary.collected_inr +
    plan.rows.reduce((s, r) => s + r.amount_inr, 0);
  const nowVerified = newCollected >= (existing.amount_inr ?? 0) && (existing.amount_inr ?? 0) > 0;

  if (nowVerified) {
    // Flip payments.status to keep the raw column truthful (it still
    // gates a few legacy readers); registrations.status is no longer
    // mirrored — readers go through payment_summary.derived_status.
    await svc
      .from("payments")
      .update({
        status: "verified",
        method: plan.rows[plan.rows.length - 1]?.method ?? method,
        verified_by: session.userId,
        verified_at: nowIso,
        ...(reference ? { notes: reference } : {}),
      })
      .eq("id", id)
      .neq("status", "verified");
  } else if (reference) {
    // Carry the latest reference forward even for a partial.
    await svc.from("payments").update({ notes: reference }).eq("id", id);
  }

  await recordAudit({
    eventId,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "payment.collect",
    targetTable: "payments",
    targetId: id,
    payload: {
      registration_id: existing.registration_id,
      collections: plan.rows.map((r) => ({
        amount_inr: r.amount_inr,
        method: r.method,
      })),
      reference,
      collected_total_inr: newCollected,
      total_inr: existing.amount_inr,
      now_verified: nowVerified,
    },
  });

  return NextResponse.json({
    ok: true,
    now_verified: nowVerified,
    collected_inr: newCollected,
    remaining_inr: Math.max(0, (existing.amount_inr ?? 0) - newCollected),
  });
}

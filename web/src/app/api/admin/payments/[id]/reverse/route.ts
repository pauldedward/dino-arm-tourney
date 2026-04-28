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
 * POST /api/admin/payments/[id]/reverse
 *
 * Undo an accidental verification. Soft-reverses one or more
 * `payment_collections` rows so the audit trail stays intact, then
 * recomputes `payments.status` and the linked `registrations.status`.
 *
 * Body:
 *   { collection_id?: string,    // soft-reverse just this row
 *     all?: boolean,             // soft-reverse every active collection
 *     reason: string }           // mandatory — operator must explain
 *
 * Default (neither field) = reverse the most recent active collection.
 *
 * Returns the new summary so the UI can update without re-fetching.
 */
interface Body {
  collection_id?: unknown;
  all?: unknown;
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
  const reason =
    typeof body.reason === "string" && body.reason.trim().length >= 3
      ? body.reason.trim().slice(0, 500)
      : null;
  if (!reason) {
    return NextResponse.json(
      { error: "reason required (min 3 chars)" },
      { status: 400 }
    );
  }
  const collectionId =
    typeof body.collection_id === "string" && body.collection_id.length > 0
      ? body.collection_id
      : null;
  const reverseAll = body.all === true;

  const svc = createServiceClient();
  const { data: existing, error: selErr } = await svc
    .from("payments")
    .select(
      "id, registration_id, status, amount_inr, registrations!inner(event_id), payment_collections(id, amount_inr, reversed_at, collected_at)"
    )
    .eq("id", id)
    .maybeSingle();
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "payment not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = (existing as any).registrations?.event_id ?? null;
  const collections =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((existing as any).payment_collections as Array<{
      id: string;
      amount_inr: number;
      reversed_at: string | null;
      collected_at: string;
    }> | null) ?? [];

  const active = collections.filter((c) => !c.reversed_at);
  if (active.length === 0) {
    return NextResponse.json(
      { error: "no active collections to reverse" },
      { status: 400 }
    );
  }

  let toReverseIds: string[];
  if (collectionId) {
    const target = active.find((c) => c.id === collectionId);
    if (!target) {
      return NextResponse.json(
        { error: "collection_id not found among active collections" },
        { status: 404 }
      );
    }
    toReverseIds = [collectionId];
  } else if (reverseAll) {
    toReverseIds = active.map((c) => c.id);
  } else {
    // Default: most recent first.
    const sorted = [...active].sort((a, b) =>
      a.collected_at < b.collected_at ? 1 : -1
    );
    toReverseIds = [sorted[0].id];
  }

  const nowIso = new Date().toISOString();
  const { error: updColErr } = await svc
    .from("payment_collections")
    .update({
      reversed_at: nowIso,
      reversed_by: session.userId,
      reversal_reason: reason,
    })
    .in("id", toReverseIds);
  if (updColErr) {
    return NextResponse.json({ error: updColErr.message }, { status: 500 });
  }

  // Recompute summary against the surviving active collections.
  const survivingActive = active.filter((c) => !toReverseIds.includes(c.id));
  const newSummary = summarisePayment(
    existing.amount_inr ?? 0,
    survivingActive as CollectionLike[]
  );

  // Flip statuses if the reversal moved us across the verified threshold.
  if (existing.status === "verified" && !newSummary.fully_collected) {
    await svc
      .from("payments")
      .update({
        status: "pending",
        verified_by: null,
        verified_at: null,
      })
      .eq("id", id);
    if (existing.registration_id) {
      await svc
        .from("registrations")
        .update({ status: "pending" })
        .eq("id", existing.registration_id)
        .eq("status", "paid");
    }
  }

  await recordAudit({
    eventId,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "payment.reverse",
    targetTable: "payments",
    targetId: id,
    payload: {
      registration_id: existing.registration_id,
      reversed_collection_ids: toReverseIds,
      reason,
      collected_inr: newSummary.collected_inr,
      remaining_inr: newSummary.remaining_inr,
      still_verified: newSummary.fully_collected,
    },
  });

  return NextResponse.json({
    ok: true,
    reversed_collection_ids: toReverseIds,
    collected_inr: newSummary.collected_inr,
    remaining_inr: newSummary.remaining_inr,
    now_verified: newSummary.fully_collected,
  });
}

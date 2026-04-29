import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";
import {
  planCollection,
  summarisePayment,
  type CollectionLike,
} from "@/lib/payments/collections";
import { allocatePool } from "@/lib/payments/allocate-pool";

export const runtime = "nodejs";

/**
 * POST /api/admin/payments/bulk
 *
 * Body shapes:
 *   { ids: string[], action: "verify" | "reject" }
 *   { ids: string[], action: "collect", method: "cash"|"manual_upi"|"waiver",
 *     reference?: string, waive_remainder?: boolean }
 *
 * `collect` writes one or two `payment_collections` rows per payment.
 * Each id gets its own remaining-balance computation so a "Trichy DC
 * bundle" can pay off mixed-balance athletes in one click.
 *
 * Idempotent: payments already `verified` are skipped (counted into
 * `alreadyResolved`). Bounded to 500 ids/call.
 */
const COLLECT_METHODS = new Set(["cash", "manual_upi", "waiver"]);

export async function POST(req: NextRequest) {
  const session = await requireRole("operator", "/admin");

  let body: {
    ids?: unknown;
    action?: unknown;
    method?: unknown;
    reference?: unknown;
    waive_remainder?: unknown;
    pool_amount_inr?: unknown;
    payer_label?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const action = body.action;
  if (action !== "verify" && action !== "reject" && action !== "collect") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const collectMethod = action === "collect" ? String(body.method ?? "") : null;
  if (action === "collect" && !COLLECT_METHODS.has(collectMethod ?? "")) {
    return NextResponse.json(
      { error: `method must be one of ${[...COLLECT_METHODS].join(", ")}` },
      { status: 400 }
    );
  }
  const reference =
    action === "collect" &&
    typeof body.reference === "string" &&
    body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 500)
      : null;
  const waiveRemainder = action === "collect" && body.waive_remainder === true;
  // Pool mode: a single ₹X is spread oldest-first across pending
  // athletes. Optional — when absent the legacy "settle each remainder"
  // semantics kick in.
  const poolAmount =
    action === "collect" &&
    typeof body.pool_amount_inr === "number" &&
    Number.isFinite(body.pool_amount_inr) &&
    body.pool_amount_inr > 0
      ? Math.floor(body.pool_amount_inr)
      : null;
  const payerLabel =
    action === "collect" &&
    typeof body.payer_label === "string" &&
    body.payer_label.trim().length > 0
      ? body.payer_label.trim().slice(0, 200)
      : null;

  const ids = Array.isArray(body.ids)
    ? (body.ids.filter((x) => typeof x === "string" && x.length > 0) as string[])
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "no ids" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "too many ids (max 500)" }, { status: 400 });
  }

  const svc = createServiceClient();

  // Fetch payments + their collections in one go so we can compute the
  // per-id remaining without N round-trips. Pull `registrations.created_at`
  // so pool mode can settle athletes oldest-first deterministically.
  const { data: existing, error: selErr } = await svc
    .from("payments")
    .select(
      "id, registration_id, status, amount_inr, registrations!inner(event_id, created_at), payment_collections(amount_inr, reversed_at)"
    )
    .in("id", ids);
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  const pending = (existing ?? []).filter((p) => p.status !== "verified");
  const alreadyResolved = (existing ?? []).length - pending.length;
  const missing = ids.length - (existing ?? []).length;

  if (action === "collect") {
    // Pool + waiver doesn't make sense — waiver always covers full
    // remainder per athlete, so a typed pool would be ignored.
    if (poolAmount !== null && collectMethod === "waiver") {
      return NextResponse.json(
        { error: "pool_amount_inr cannot be used with method=waiver" },
        { status: 400 }
      );
    }

    let updated = 0;
    const allInsertRows: Array<{
      payment_id: string;
      amount_inr: number;
      method: string;
      reference: string | null;
      payer_label: string | null;
      collected_by: string | null;
      collected_at: string;
    }> = [];
    const verifiedIds: string[] = [];
    const verifiedRegIds: string[] = [];
    const auditEvents: Array<{
      paymentId: string;
      eventId: string | null;
      regId: string | null;
      rows: { amount_inr: number; method: string }[];
      newCollected: number;
      total: number;
      nowVerified: boolean;
    }> = [];

    const nowIso = new Date().toISOString();

    // Sort pending oldest-first by registration created_at so the pool
    // allocator (and the legacy "settle each remainder" path) walk the
    // list in a stable, intuitive order. Falls back to payment id as
    // a last-resort tiebreaker.
    const orderedPending = [...pending].sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ca = (a as any).registrations?.created_at ?? "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cb = (b as any).registrations?.created_at ?? "";
      if (ca === cb) return a.id.localeCompare(b.id);
      return ca < cb ? -1 : 1;
    });

    // Pre-compute each pending row's summary once. Pool mode uses these
    // to decide per-id amounts; non-pool mode uses them directly.
    const summaries = new Map<
      string,
      ReturnType<typeof summarisePayment> & { collections: CollectionLike[] }
    >();
    for (const p of orderedPending) {
      const collections =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((p as any).payment_collections as CollectionLike[] | null) ?? [];
      const s = summarisePayment(p.amount_inr ?? 0, collections);
      summaries.set(p.id, { ...s, collections });
    }

    // Decide per-id amounts. In pool mode we run the greedy allocator
    // over the ordered pending list; otherwise each id settles its own
    // remainder.
    let perIdAmount: Map<string, number>;
    let allocResult: ReturnType<typeof allocatePool> | null = null;
    if (poolAmount !== null) {
      allocResult = allocatePool(
        poolAmount,
        orderedPending.map((p) => ({
          id: p.id,
          remaining_inr: summaries.get(p.id)?.remaining_inr ?? 0,
        }))
      );
      perIdAmount = new Map(
        allocResult.allocations.map((a) => [a.id, a.amount_inr])
      );
    } else {
      perIdAmount = new Map(
        orderedPending.map((p) => [
          p.id,
          summaries.get(p.id)?.remaining_inr ?? 0,
        ])
      );
    }

    for (const p of orderedPending) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const evId = (p as any).registrations?.event_id ?? null;
      const summary = summaries.get(p.id);
      if (!summary || summary.remaining_inr <= 0) continue;
      const allocated = perIdAmount.get(p.id) ?? 0;
      // In pool mode an athlete past the boundary gets 0 — skip unless
      // the operator also asked us to waive their shortfall.
      if (allocated === 0 && !waiveRemainder) continue;

      const plan = planCollection(summary, {
        method: collectMethod as "cash" | "manual_upi" | "waiver",
        amount_inr: allocated,
        waive_remainder: waiveRemainder,
        reference,
      });
      if (!plan.ok) continue;

      for (const r of plan.rows) {
        allInsertRows.push({
          payment_id: p.id,
          amount_inr: r.amount_inr,
          method: r.method,
          reference,
          payer_label: payerLabel,
          collected_by: session.userId,
          collected_at: nowIso,
        });
      }
      const newCollected =
        summary.collected_inr + plan.rows.reduce((s, r) => s + r.amount_inr, 0);
      const nowVerified =
        newCollected >= (p.amount_inr ?? 0) && (p.amount_inr ?? 0) > 0;
      if (nowVerified) {
        verifiedIds.push(p.id);
        if (p.registration_id) verifiedRegIds.push(p.registration_id);
      }
      updated += 1;
      auditEvents.push({
        paymentId: p.id,
        eventId: evId,
        regId: p.registration_id ?? null,
        rows: plan.rows.map((r) => ({
          amount_inr: r.amount_inr,
          method: r.method,
        })),
        newCollected,
        total: p.amount_inr ?? 0,
        nowVerified,
      });
    }

    if (allInsertRows.length > 0) {
      const { error: insErr } = await svc
        .from("payment_collections")
        .insert(allInsertRows);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    if (verifiedIds.length > 0) {
      await svc
        .from("payments")
        .update({
          status: "verified",
          method: collectMethod!,
          verified_by: session.userId,
          verified_at: nowIso,
          ...(reference ? { notes: reference } : {}),
        })
        .in("id", verifiedIds)
        .neq("status", "verified");
    }
    // Post-0039: no mirror onto registrations.status.

    await Promise.all(
      auditEvents.map((a) =>
        recordAudit({
          eventId: a.eventId,
          actorId: session.userId,
          actorLabel: session.fullName ?? session.email,
          action: "payment.collect",
          targetTable: "payments",
          targetId: a.paymentId,
          payload: {
            registration_id: a.regId,
            bulk: true,
            collections: a.rows,
            reference,
            payer_label: payerLabel,
            pool_total_inr: poolAmount,
            collected_total_inr: a.newCollected,
            total_inr: a.total,
            now_verified: a.nowVerified,
          },
        })
      )
    );

    return NextResponse.json({
      ok: true,
      updated,
      alreadyResolved,
      missing,
      ...(allocResult
        ? {
            pool: {
              total_inr: poolAmount,
              leftover_inr: allocResult.leftover_inr,
              fully: allocResult.fully_ids.length,
              partial: allocResult.partial_ids.length,
              untouched: allocResult.untouched_ids.length,
            },
          }
        : {}),
    });
  }

  // ── verify / reject paths (legacy proof-review actions) ─────────────
  // For `verify` we treat it like a collect-the-rest with the existing
  // method (typically manual_upi) — that way the collections table
  // stays consistent. `reject` just flips the status, no collection.
  const nowIso = new Date().toISOString();
  if (action === "verify") {
    const insertRows: Array<{
      payment_id: string;
      amount_inr: number;
      method: string;
      reference: string | null;
      collected_by: string | null;
      collected_at: string;
    }> = [];
    const verifiedIds: string[] = [];
    const verifiedRegIds: string[] = [];

    for (const p of pending) {
      const collections =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((p as any).payment_collections as CollectionLike[] | null) ?? [];
      const summary = summarisePayment(p.amount_inr ?? 0, collections);
      if (summary.remaining_inr > 0) {
        insertRows.push({
          payment_id: p.id,
          amount_inr: summary.remaining_inr,
          method: "manual_upi",
          reference: "verified from proof",
          collected_by: session.userId,
          collected_at: nowIso,
        });
      }
      verifiedIds.push(p.id);
      if (p.registration_id) verifiedRegIds.push(p.registration_id);
    }

    if (insertRows.length > 0) {
      const { error: insErr } = await svc
        .from("payment_collections")
        .insert(insertRows);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    if (verifiedIds.length > 0) {
      await svc
        .from("payments")
        .update({
          status: "verified",
          verified_by: session.userId,
          verified_at: nowIso,
        })
        .in("id", verifiedIds)
        .neq("status", "verified");
    }
    // Post-0039: no mirror onto registrations.status.
  } else {
    // reject
    if (pending.length > 0) {
      await svc
        .from("payments")
        .update({ status: "rejected" })
        .in(
          "id",
          pending.map((p) => p.id)
        )
        .neq("status", "verified");
    }
  }

  const auditAction = `payment.${action}`;
  await Promise.all(
    pending.map((p) =>
      recordAudit({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventId: (p as any).registrations?.event_id ?? null,
        actorId: session.userId,
        actorLabel: session.fullName ?? session.email,
        action: auditAction,
        targetTable: "payments",
        targetId: p.id,
        payload: {
          registration_id: p.registration_id,
          bulk: true,
        },
      })
    )
  );

  return NextResponse.json({
    ok: true,
    updated: pending.length,
    alreadyResolved,
    missing,
  });
}

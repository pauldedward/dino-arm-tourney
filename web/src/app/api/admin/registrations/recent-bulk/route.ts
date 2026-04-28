import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { isWeighed } from "@/lib/payments/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/registrations/recent-bulk?event_id=...&limit=50&q=...&status=...
 *
 * Powers the right rail of the counter-desk operator screen. Returns the
 * most recent registrations for the event regardless of whether they
 * came from self-registration or the bulk desk — the desk is the canonical
 * place to load and edit any registration.
 *
 * If `q` is provided, results are filtered (case-insensitive) across
 * full_name / district / team / mobile, plus chest_no when q is numeric.
 * `status` is one of: "paid" | "due" | "weighed-in" | "not-weighed-in"
 * and stacks on top of `q`.
 *
 * Always returns `total` = the unfiltered count of registrations for the
 * event so the UI can show "Matches X of N".
 *
 * Endpoint name is kept for backwards-compatibility with the existing
 * BulkRegistrationDesk fetch.
 */
export async function GET(req: NextRequest) {
  await requireRole("operator", "/admin");

  const sp = req.nextUrl.searchParams;
  const eventId = sp.get("event_id") ?? "";
  if (!eventId) {
    return NextResponse.json({ error: "event_id required" }, { status: 400 });
  }
  const limit = Math.min(
    200,
    Math.max(1, parseInt(sp.get("limit") ?? "50", 10) || 50)
  );
  const q = (sp.get("q") ?? "").trim();
  // Legacy single-axis filter (kept for back-compat).
  const statusFilter = sp.get("status") ?? "";
  // New orthogonal filters. UI sends one or both; absent → no filter.
  const payFilter = sp.get("pay") ?? ""; // "" | "paid" | "non-paid" (legacy: "partial" | "due")
  const checkinFilter = sp.get("checkin") ?? ""; // "" | "weighed-in" | "not-weighed-in" (legacy: "no-show" | "not-arrived")

  const svc = createServiceClient();

  // Cheap unfiltered total — head-only count avoids shipping rows.
  const totalReq = svc
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);

  let query = svc
    .from("registrations")
    .select(
      "id, full_name, initial, chest_no, district, team, declared_weight_kg, weight_class_code, status, checkin_status, paid_amount_inr, payments(status, amount_inr, payment_collections(amount_inr, reversed_at)), weigh_ins(id)"
    )
    .eq("event_id", eventId);

  if (q) {
    // PostgREST `or` filter. Wrap the user input so commas/parens can't
    // break the filter syntax — Supabase escapes via the percent-encoded
    // value, but we still strip the few characters PostgREST treats as
    // delimiters inside an `or` group.
    const safe = q.replace(/[(),]/g, " ").trim();
    const ors = [
      `full_name.ilike.%${safe}%`,
      `district.ilike.%${safe}%`,
      `team.ilike.%${safe}%`,
      `mobile.ilike.%${safe}%`,
    ];
    if (/^\d+$/.test(safe)) ors.push(`chest_no.eq.${safe}`);
    query = query.or(ors.join(","));
  }

  // Check-in axis (server-side, indexed). Accepts new param `checkin` or
  // the legacy `status` value for back-compat.
  const checkin = checkinFilter || statusFilter;
  if (checkin === "weighed-in") {
    query = query.eq("checkin_status", "weighed_in");
  } else if (checkin === "no-show") {
    query = query.eq("checkin_status", "no_show");
  } else if (checkin === "not-arrived") {
    query = query.eq("checkin_status", "not_arrived");
  } else if (checkin === "not-weighed-in") {
    // Legacy combo (no-show + not-arrived).
    query = query.neq("checkin_status", "weighed_in");
  }

  const [{ data, error }, { count: total }] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(limit),
    totalReq,
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = (data ?? []).map((r) => {
    const pay = Array.isArray(r.payments) ? r.payments[0] : null;
    // Sum active (non-reversed) collections so the right-rail badge can
    // show "₹200 / ₹500" when a row is settling in installments.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols = ((pay as any)?.payment_collections as Array<{
      amount_inr: number;
      reversed_at: string | null;
    }> | undefined) ?? [];
    const collectedInr = cols.reduce(
      (s, c) => (c.reversed_at ? s : s + (c.amount_inr ?? 0)),
      0
    );
    const totalInr = pay?.amount_inr ?? null;
    return {
      id: r.id as string,
      client_id: r.id as string,
      status: "saved" as const,
      full_name: r.full_name ?? null,
      initial: r.initial ?? null,
      chest_no: r.chest_no ?? null,
      district: r.district ?? null,
      team: r.team ?? null,
      declared_weight_kg: r.declared_weight_kg ?? null,
      weight_class_code: r.weight_class_code ?? null,
      payment_status: pay?.status ?? null,
      paid_amount_inr: collectedInr || r.paid_amount_inr || null,
      total_fee_inr: totalInr,
      collected_inr: collectedInr,
      remaining_inr:
        totalInr != null ? Math.max(0, totalInr - collectedInr) : null,
      checkin_status: (r.checkin_status as
        | "not_arrived"
        | "weighed_in"
        | "no_show"
        | null) ?? null,
      lifecycle:
        r.status === "withdrawn"
          ? ("withdrawn" as const)
          : r.status === "disqualified"
          ? ("disqualified" as const)
          : ("active" as const),
      approved: isWeighed(
        r.status,
        Array.isArray(r.weigh_ins) ? r.weigh_ins : null,
        r.checkin_status as string | null | undefined,
      ),
      saved_at: 0,
    };
  });

  // Payment-status filter is applied here because it lives on the
  // joined `payments` table; PostgREST can't filter on a one-to-many
  // join without an inner-join hint, and most regs only have one
  // payment row anyway.
  const pay = payFilter || statusFilter;
  if (pay === "paid") {
    rows = rows.filter((r) => r.payment_status === "verified");
  } else if (pay === "non-paid") {
    rows = rows.filter((r) => r.payment_status !== "verified");
  } else if (pay === "partial") {
    rows = rows.filter(
      (r) =>
        r.payment_status !== "verified" &&
        (r.collected_inr ?? 0) > 0 &&
        r.total_fee_inr != null &&
        (r.remaining_inr ?? 0) > 0,
    );
  } else if (pay === "due") {
    rows = rows.filter(
      (r) => r.payment_status !== "verified" && (r.collected_inr ?? 0) === 0,
    );
  }

  return NextResponse.json({ rows, total: total ?? rows.length });
}

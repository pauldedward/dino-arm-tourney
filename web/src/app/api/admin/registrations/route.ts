import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/registrations
 *
 * Fast JSON listing for the operator console. Pagination via
 * `?page=1&pageSize=100`, plus the same filters as the CSV export.
 * Returns { rows, total, page, pageSize } so the client table can
 * show a footer + bulk-select-all-matching count.
 */
export async function GET(req: NextRequest) {
  await requireRole("operator", "/admin");

  const sp = req.nextUrl.searchParams;
  const eventId = sp.get("event_id") ?? "";
  const q = (sp.get("q") ?? "").trim();
  const division = sp.get("division") ?? "";
  // Lifecycle (entry) filter — active / withdrawn / disqualified.
  // `status` is kept as a back-compat alias.
  const entry = sp.get("entry") ?? sp.get("status") ?? "";
  // Check-in axis — not_arrived / weighed_in / no_show.
  const checkin = sp.get("checkin") ?? "";
  const payment = sp.get("payment") ?? ""; // "" | pending | review | verified | rejected | partial | unpaid | collected
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(10, parseInt(sp.get("pageSize") ?? "100", 10) || 100)
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const svc = createServiceClient();

  let query = svc
    .from("registrations")
    .select(
      "id, event_id, chest_no, full_name, initial, division, district, team, declared_weight_kg, weight_class_code, status, checkin_status, gender, nonpara_classes, nonpara_hands, nonpara_hand, para_codes, para_hand, payments(id, amount_inr, status, method, utr, proof_url, verified_at, payment_collections(id, amount_inr, method, reversed_at, payer_label))",
      { count: "estimated" }
    )
    .order("chest_no", { ascending: true, nullsFirst: false })
    .range(from, to);

  if (eventId) query = query.eq("event_id", eventId);
  if (division) query = query.eq("division", division);
  if (entry === "active") {
    query = query.not("status", "in", "(withdrawn,disqualified)");
  } else if (entry === "withdrawn" || entry === "disqualified") {
    query = query.eq("status", entry);
  } else if (entry) {
    // Legacy values (pending/paid/weighed_in) — honor for back-compat.
    query = query.eq("status", entry);
  }
  if (checkin === "weighed_in" || checkin === "no_show" || checkin === "not_arrived") {
    query = query.eq("checkin_status", checkin);
  }
  if (q) {
    query = query.or(
      `full_name.ilike.%${q}%,mobile.ilike.%${q}%,district.ilike.%${q}%`
    );
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = data ?? [];
  // Payment filter applied client-side because it's a join, not a column.
  if (payment) {
    rows = rows.filter((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p: any = Array.isArray(r.payments) ? r.payments[0] : null;
      if (!p) return payment === "pending" || payment === "unpaid";
      if (payment === "unpaid") return p.status === "pending";
      if (payment === "review") return p.status === "pending" && !!p.utr;
      if (payment === "collected")
        return p.status === "verified" && p.method !== "manual_upi";
      if (payment === "partial") {
        const cols: Array<{ amount_inr: number; reversed_at: string | null }> =
          p.payment_collections ?? [];
        const collected = cols.reduce(
          (s, c) => (c.reversed_at ? s : s + (c.amount_inr ?? 0)),
          0,
        );
        const total = p.amount_inr ?? 0;
        return p.status !== "verified" && collected > 0 && total > collected;
      }
      return p.status === payment;
    });
  }

  return NextResponse.json({
    rows,
    total: count ?? rows.length,
    page,
    pageSize,
  });
}

/**
 * POST /api/admin/registrations/ids
 *
 * Returns just the registration ids matching the current filters
 * (capped at 5000) so the operator can "select all matching" for a
 * bulk action without paging through the table.
 */
export async function POST(req: NextRequest) {
  await requireRole("operator", "/admin");

  const sp = req.nextUrl.searchParams;
  const eventId = sp.get("event_id") ?? "";
  const q = (sp.get("q") ?? "").trim();
  const division = sp.get("division") ?? "";
  const entry = sp.get("entry") ?? sp.get("status") ?? "";
  const checkin = sp.get("checkin") ?? "";

  const svc = createServiceClient();
  let query = svc
    .from("registrations")
    .select("id")
    .order("chest_no", { ascending: true, nullsFirst: false })
    .limit(5000);
  if (eventId) query = query.eq("event_id", eventId);
  if (division) query = query.eq("division", division);
  if (entry === "active") {
    query = query.not("status", "in", "(withdrawn,disqualified)");
  } else if (entry) {
    query = query.eq("status", entry);
  }
  if (checkin === "weighed_in" || checkin === "no_show" || checkin === "not_arrived") {
    query = query.eq("checkin_status", checkin);
  }
  if (q) {
    query = query.or(
      `full_name.ilike.%${q}%,mobile.ilike.%${q}%,district.ilike.%${q}%`
    );
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ids: (data ?? []).map((r) => r.id) });
}

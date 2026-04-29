import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { exportFilename } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/registrations.csv?event_id=…&q=…&division=…&status=…
 *
 * Streams a CSV of registrations scoped to the filters. Does NOT include
 * Aadhaar or other PII beyond what already appears in the admin UI.
 */
export async function GET(req: NextRequest) {
  await requireRole("operator", "/admin");

  const sp = req.nextUrl.searchParams;
  const eventId = sp.get("event_id") ?? "";
  const q = sp.get("q") ?? "";
  const division = sp.get("division") ?? "";
  const status = sp.get("status") ?? "";
  // Optional lifecycle / discipline / checkin filters — each is
  // single-axis. `status` is kept for back-compat with old bookmarks.
  const lifecycle = sp.get("lifecycle") ?? "";
  const discipline = sp.get("discipline") ?? "";
  const checkin = sp.get("checkin") ?? "";

  const svc = createServiceClient();
  let query = svc
    .from("registrations")
    .select(
      "id, chest_no, full_name, initial, dob, division, district, team, mobile, declared_weight_kg, weight_class_code, youth_hand, senior_hand, status, lifecycle_status, discipline_status, checkin_status, created_at, event_id, events(name, slug), payments(amount_inr, status, utr)"
    )
    .order("chest_no", { ascending: true, nullsFirst: false })
    .limit(10000);
  if (eventId) query = query.eq("event_id", eventId);
  if (division) query = query.eq("division", division);
  if (lifecycle === "active" || lifecycle === "withdrawn")
    query = query.eq("lifecycle_status", lifecycle);
  if (discipline === "clear" || discipline === "disqualified")
    query = query.eq("discipline_status", discipline);
  if (checkin === "weighed_in" || checkin === "no_show" || checkin === "not_arrived")
    query = query.eq("checkin_status", checkin);
  if (status) query = query.eq("status", status);
  if (q) {
    query = query.or(`full_name.ilike.%${q}%,mobile.ilike.%${q}%,district.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return new Response(`error,${csvEscape(error.message)}\n`, {
      status: 500,
      headers: { "content-type": "text/csv" },
    });
  }

  // Pull the installment-aware snapshot in parallel so the CSV's
  // payment_status column reflects partial collections (the same
  // single-source-of-truth view that powers the dashboard and the
  // payment report).
  const regIds = (data ?? []).map((r) => r.id as string).filter(Boolean);
  const { data: sums } = regIds.length
    ? await svc
        .from("payment_summary")
        .select(
          "registration_id, total_inr, collected_inr, remaining_inr, derived_status, latest_payer_label"
        )
        .in("registration_id", regIds)
    : { data: [] as never[] };
  const sumByReg = new Map(
    (sums ?? []).map((s) => [
      s.registration_id as string,
      {
        total: Number(s.total_inr ?? 0),
        paid: Number(s.collected_inr ?? 0),
        due: Number(s.remaining_inr ?? 0),
        derived: (s.derived_status as string) ?? "pending",
        paid_by: (s.latest_payer_label as string | null) ?? null,
      },
    ])
  );

  const headers = [
    "chest_no",
    "full_name",
    "division",
    "district",
    "team",
    "mobile",
    "dob",
    "weight_kg",
    "weight_class",
    "youth_hand",
    "senior_hand",
    "lifecycle_status",
    "discipline_status",
    "checkin_status",
    "payment_status",
    "utr",
    "total_inr",
    "paid_inr",
    "due_inr",
    "paid_by",
    "event_name",
    "event_slug",
    "registered_at",
  ];

  const lines: string[] = [headers.join(",")];
  for (const r of data ?? []) {
    const event = Array.isArray(r.events) ? r.events[0] : r.events;
    const pay = Array.isArray(r.payments) ? r.payments[0] : null;
    const s = sumByReg.get(r.id as string);
    const row = [
      r.chest_no ?? "",
      `${r.initial ? r.initial + ". " : ""}${r.full_name ?? ""}`,
      r.division ?? "",
      r.district ?? "",
      r.team ?? "",
      r.mobile ?? "",
      r.dob ?? "",
      r.declared_weight_kg ?? "",
      r.weight_class_code ?? "",
      r.youth_hand ?? "",
      r.senior_hand ?? "",
      (r.lifecycle_status as string | null) ?? "active",
      (r.discipline_status as string | null) ?? "clear",
      r.checkin_status ?? "",
      s?.derived ?? pay?.status ?? "",
      pay?.utr ?? "",
      s?.total ?? pay?.amount_inr ?? "",
      s?.paid ?? "",
      s?.due ?? "",
      s?.paid_by ?? "",
      event?.name ?? "",
      event?.slug ?? "",
      r.created_at ?? "",
    ];
    lines.push(row.map((v) => csvEscape(String(v))).join(","));
  }

  // Pick a meaningful event segment for the filename. We already joined the
  // event in the row select, so reuse the first row's event metadata before
  // falling back to a lookup-free "all-events" file.
  const firstEvent = (() => {
    const first = (data ?? [])[0];
    if (!first) return null;
    const ev = Array.isArray(first.events) ? first.events[0] : first.events;
    return ev ?? null;
  })();
  const body = lines.join("\n") + "\n";
  const filename = exportFilename({
    eventSlug: firstEvent?.slug ?? null,
    eventName: firstEvent?.name ?? null,
    kind: "registrations",
    ext: "csv",
  });
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function csvEscape(s: string): string {
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

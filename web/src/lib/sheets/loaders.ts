/**
 * Shared data-loaders for downloadable sheets (PDF + XLSX).
 *
 * Both export formats hit the same Supabase queries so the rows match
 * what the operator sees on screen — no surprise mismatches between
 * the printed PDF and the spreadsheet copy.
 */
import { createServiceClient } from "@/lib/db/supabase-service";
import type { PaymentReportRow, PaymentReportTotals } from "@/lib/pdf/PaymentReportSheet";
import type { NominalRow } from "@/lib/pdf/NominalSheet";
import type { CategoryRow } from "@/lib/pdf/CategorySheet";
import { buildNominalRows } from "@/lib/sheets/build-nominal";

type SvcClient = ReturnType<typeof createServiceClient>;

export interface SheetFilters {
  q?: string;
  division?: string;
  status?: string;
}

/* ------------------------------------------------------------------ */
/*                          Payment report                            */
/* ------------------------------------------------------------------ */

export async function loadPaymentReport(
  svc: SvcClient,
  eventId: string,
  filters: SheetFilters = {}
): Promise<{ rows: PaymentReportRow[]; totals: PaymentReportTotals }> {
  // Two queries instead of one embedded join: registrations for the
  // athlete metadata, and `payment_summary` (the SQL view introduced in
  // migration 0028) for the installment-aware ₹ math. The view is the
  // single source of truth — same logic feeds the dashboard RPC and
  // the dashboard's "By district" card, so the printed report and the
  // on-screen summary cannot drift apart.
  let regQuery = svc
    .from("registrations")
    .select(
      "id, chest_no, full_name, initial, division, district, team, youth_hand, senior_hand, status, event_id"
    )
    .eq("event_id", eventId)
    .order("chest_no", { ascending: true, nullsFirst: false })
    .limit(10000);
  if (filters.division) regQuery = regQuery.eq("division", filters.division);
  if (filters.status) regQuery = regQuery.eq("status", filters.status);
  if (filters.q) {
    regQuery = regQuery.or(
      `full_name.ilike.%${filters.q}%,mobile.ilike.%${filters.q}%,district.ilike.%${filters.q}%`
    );
  }
  const [regRes, sumRes] = await Promise.all([
    regQuery,
    svc
      .from("payment_summary")
      .select(
        "registration_id, total_inr, collected_inr, remaining_inr, derived_status, latest_payer_label"
      )
      .eq("event_id", eventId)
      .limit(20000),
  ]);
  if (regRes.error) throw new Error(regRes.error.message);
  if (sumRes.error) throw new Error(sumRes.error.message);

  const summaryByReg = new Map<
    string,
    {
      total_inr: number;
      collected_inr: number;
      remaining_inr: number;
      paid_by: string | null;
    }
  >();
  for (const s of sumRes.data ?? []) {
    // If a registration somehow has multiple payments rows, fold them.
    const prev = summaryByReg.get(s.registration_id as string);
    const total = (prev?.total_inr ?? 0) + Number(s.total_inr ?? 0);
    const collected = (prev?.collected_inr ?? 0) + Number(s.collected_inr ?? 0);
    const remaining =
      (prev?.remaining_inr ?? 0) +
      (s.derived_status === "pending" ? Number(s.remaining_inr ?? 0) : 0);
    summaryByReg.set(s.registration_id as string, {
      total_inr: total,
      collected_inr: collected,
      remaining_inr: remaining,
      paid_by:
        (s.latest_payer_label as string | null) ?? prev?.paid_by ?? null,
    });
  }

  const rows: PaymentReportRow[] = (regRes.data ?? []).map((r) => {
    const s = summaryByReg.get(r.id as string);
    return {
      chest_no: r.chest_no ?? null,
      full_name: `${r.initial ? r.initial + ". " : ""}${r.full_name ?? ""}`.trim() || null,
      team_or_district: r.district ?? r.team ?? null,
      category: buildCategory(r.youth_hand, r.senior_hand, r.division),
      total_inr: s?.total_inr ?? 0,
      paid_inr: s?.collected_inr ?? 0,
      due_inr: s?.remaining_inr ?? 0,
      paid_by: s?.paid_by ?? null,
    };
  });

  const total_athletes = rows.length;
  const total_paid = rows.reduce((s, r) => s + r.paid_inr, 0);
  const total_due = rows.reduce((s, r) => s + r.due_inr, 0);
  const percent_paid =
    total_paid + total_due > 0
      ? (total_paid / (total_paid + total_due)) * 100
      : 0;

  return {
    rows,
    totals: { total_athletes, total_paid, total_due, percent_paid },
  };
}

function buildCategory(
  youthHand: string | null,
  seniorHand: string | null,
  division: string | null
): string {
  const parts: string[] = [];
  if (youthHand) parts.push(`Youth(${shortHand(youthHand)})`);
  if (seniorHand) parts.push(`Senior(${shortHand(seniorHand)})`);
  if (parts.length === 0 && division) parts.push(division);
  return parts.join(", ");
}

function shortHand(h: string): string {
  const v = h.toLowerCase();
  if (v.startsWith("l")) return "L";
  if (v.startsWith("r")) return "R";
  if (v.startsWith("b")) return "B";
  return h;
}

/* ------------------------------------------------------------------ */
/*                           Nominal roll                             */
/* ------------------------------------------------------------------ */

export async function loadNominal(
  svc: SvcClient,
  eventId: string,
  filters: SheetFilters = {}
): Promise<NominalRow[]> {
  // Fetch the registration metadata, the installment-aware payment
  // snapshot (single source of truth for paid), and the weigh_ins
  // table (cross-checked with checkin_status). The mapper combines
  // them so the PDF + XLSX exports report "paid" and "weighed"
  // identically to the operator console.
  let regQuery = svc
    .from("registrations")
    .select(
      "id, chest_no, full_name, division, district, team, declared_weight_kg, age_categories, status, checkin_status"
    )
    .eq("event_id", eventId)
    .order("full_name", { ascending: true })
    .limit(10000);
  if (filters.division) regQuery = regQuery.eq("division", filters.division);
  if (filters.q) {
    regQuery = regQuery.or(
      `full_name.ilike.%${filters.q}%,district.ilike.%${filters.q}%,team.ilike.%${filters.q}%`
    );
  }
  const [regRes, sumRes, wiRes] = await Promise.all([
    regQuery,
    svc
      .from("payment_summary")
      .select("registration_id, derived_status")
      .eq("event_id", eventId)
      .limit(20000),
    svc
      .from("weigh_ins")
      .select("registration_id, registrations!inner(event_id)")
      .eq("registrations.event_id", eventId)
      .limit(20000),
  ]);
  if (regRes.error) throw new Error(regRes.error.message);
  return buildNominalRows(
    regRes.data ?? [],
    (sumRes.data ?? []).map((s) => ({
      registration_id: s.registration_id as string,
      derived_status: s.derived_status as string,
    })),
    (wiRes.data ?? []).map((w) => ({
      registration_id: w.registration_id as string,
    })),
  );
}

/* ------------------------------------------------------------------ */
/*                           Category sheet                           */
/* ------------------------------------------------------------------ */

export async function loadCategory(
  svc: SvcClient,
  eventId: string
): Promise<CategoryRow[]> {
  const { data, error } = await svc
    .from("entries")
    .select(
      "category_code, registrations!inner(event_id, chest_no, full_name, district)"
    )
    .eq("registrations.event_id", eventId);
  if (error) throw new Error(error.message);
  const grouped = new Map<string, CategoryRow["athletes"]>();
  for (const e of data ?? []) {
    const reg = Array.isArray(e.registrations) ? e.registrations[0] : e.registrations;
    if (!grouped.has(e.category_code)) grouped.set(e.category_code, []);
    grouped.get(e.category_code)!.push({
      chest_no: reg?.chest_no ?? null,
      full_name: reg?.full_name ?? null,
      district: reg?.district ?? null,
    });
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category_code, athletes]) => ({ category_code, athletes }));
}

/* ------------------------------------------------------------------ */
/*                              ID-cards                              */
/* ------------------------------------------------------------------ */

export async function loadIdCards(svc: SvcClient, eventId: string) {
  const { data, error } = await svc
    .from("registrations")
    .select(
      "chest_no, full_name, division, district, team, declared_weight_kg"
    )
    .eq("event_id", eventId)
    .order("chest_no", { ascending: true, nullsFirst: false })
    .limit(10000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

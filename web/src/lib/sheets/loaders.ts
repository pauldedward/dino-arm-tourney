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
import { buildOverrideRows } from "@/lib/rules/weight-overrides";
import { formatCategoryListForDisplay } from "@/lib/rules/category-label";
import type { WeightOverride } from "@/lib/rules/resolve";
import { groupRegistrationsByCategory, type CategoryGroupReg } from "@/lib/registrations/group-by-category";
import type { RegistrationLite } from "@/lib/rules/resolve";

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
      "id, chest_no, full_name, initial, gender, division, district, team, declared_weight_kg, age_categories, para_codes, para_hand, nonpara_classes, nonpara_hands, nonpara_hand, weight_overrides, youth_hand, senior_hand, status, lifecycle_status, discipline_status, event_id"
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
  const [regRes, sumRes, wiRes] = await Promise.all([
    regQuery,
    svc
      .from("payment_summary")
      .select(
        "registration_id, total_inr, collected_inr, received_inr, waived_inr, remaining_inr, derived_status, raw_status, latest_payer_label"
      )
      .eq("event_id", eventId)
      .limit(20000),
    // Weigh-ins feed `buildOverrideRows` so a competing-up athlete is
    // bucketed by the weight they actually weighed at, matching what
    // the Nominal Roll prints.
    svc
      .from("weigh_ins")
      .select("registration_id, measured_kg, registrations!inner(event_id)")
      .eq("registrations.event_id", eventId)
      .limit(20000),
  ]);
  if (regRes.error) throw new Error(regRes.error.message);
  if (sumRes.error) throw new Error(sumRes.error.message);

  const summaryByReg = new Map<
    string,
    {
      total_inr: number;
      collected_inr: number;
      received_inr: number;
      waived_inr: number;
      remaining_inr: number;
      paid_by: string | null;
      billable_inr: number;
    }
  >();
  for (const s of sumRes.data ?? []) {
    // If a registration somehow has multiple payments rows, fold them.
    const prev = summaryByReg.get(s.registration_id as string);
    const isRejected = s.raw_status === "rejected";
    const total = (prev?.total_inr ?? 0) + Number(s.total_inr ?? 0);
    const collected = (prev?.collected_inr ?? 0) + Number(s.collected_inr ?? 0);
    // Fall back to collected/0 when the SQL view predates 0037 — keeps
    // the report rendering during the migration window.
    const received =
      (prev?.received_inr ?? 0) +
      Number(s.received_inr ?? s.collected_inr ?? 0);
    const waived = (prev?.waived_inr ?? 0) + Number(s.waived_inr ?? 0);
    const remaining =
      (prev?.remaining_inr ?? 0) +
      (s.derived_status === "pending" ? Number(s.remaining_inr ?? 0) : 0);
    const billable =
      (prev?.billable_inr ?? 0) + (isRejected ? 0 : Number(s.total_inr ?? 0));
    summaryByReg.set(s.registration_id as string, {
      total_inr: total,
      collected_inr: collected,
      received_inr: received,
      waived_inr: waived,
      remaining_inr: remaining,
      billable_inr: billable,
      paid_by:
        (s.latest_payer_label as string | null) ?? prev?.paid_by ?? null,
    });
  }

  const measuredKgByReg = new Map<string, number>();
  for (const w of wiRes.data ?? []) {
    if (typeof w.measured_kg === "number") {
      measuredKgByReg.set(w.registration_id as string, w.measured_kg);
    }
  }

  const rows: PaymentReportRow[] = (regRes.data ?? []).map((r) => {
    const s = summaryByReg.get(r.id as string);
    const baseCats = ((r.age_categories as string[] | null) ?? []).filter(
      (c) => c.toUpperCase() !== "PARA"
    );
    const paraCodes = ((r.para_codes as string[] | null) ?? []).filter(Boolean);
    const ageCategories = [...baseCats, ...paraCodes];
    const refWeight =
      measuredKgByReg.get(r.id as string) ?? (r.declared_weight_kg as number | null) ?? 0;
    const overrideRows = buildOverrideRows(
      {
        gender: (r.gender as "M" | "F" | null) ?? null,
        nonpara_classes: (r.nonpara_classes as string[] | null) ?? [],
        nonpara_hands:
          ((r.nonpara_hands as Array<"R" | "L" | "B" | null> | null) &&
          ((r.nonpara_hands as unknown[]).length ?? 0) > 0
            ? (r.nonpara_hands as Array<"R" | "L" | "B" | null>)
            : ((r.nonpara_classes as string[] | null) ?? []).map(
                () => (r.nonpara_hand as "R" | "L" | "B" | null) ?? null
              )) ?? [],
        para_codes: (r.para_codes as string[] | null) ?? [],
        para_hand: (r.para_hand as "R" | "L" | "B" | null) ?? null,
        weight_overrides: (r.weight_overrides as WeightOverride[] | null) ?? [],
      },
      refWeight
    );
    const seen = new Set<string>();
    const weight_classes: string[] = [];
    for (const row of overrideRows) {
      const k = `${row.scope}|${row.code}`;
      if (seen.has(k)) continue;
      seen.add(k);
      weight_classes.push(row.selectedBucket.label + (row.competingUp ? " ↑" : ""));
    }
    return {
      chest_no: r.chest_no ?? null,
      full_name: `${r.initial ? r.initial + ". " : ""}${r.full_name ?? ""}`.trim() || null,
      team_or_district: r.district ?? r.team ?? null,
      age_categories: formatCategoryListForDisplay(ageCategories),
      weight_classes,
      // Use `billable_inr` (rejected → 0) so the per-row total agrees
      // with `total_billable` on the Summary sheet. Otherwise rejected
      // registrations inflate the Districts grand total and the %
      // collected on the Districts sheet drifts below Summary's.
      total_inr: s?.billable_inr ?? 0,
      paid_inr: s?.collected_inr ?? 0,
      received_inr: s?.received_inr ?? 0,
      waived_inr: s?.waived_inr ?? 0,
      due_inr: s?.remaining_inr ?? 0,
      paid_by: s?.paid_by ?? null,
    };
  });

  const total_athletes = rows.length;
  const total_paid = rows.reduce((s, r) => s + r.paid_inr, 0);
  const total_received = rows.reduce((s, r) => s + r.received_inr, 0);
  const total_waived = rows.reduce((s, r) => s + r.waived_inr, 0);
  const total_due = rows.reduce((s, r) => s + r.due_inr, 0);
  // Sum the same per-row `total_inr` we just put on the rows. This is
  // what the Districts grand total sums, so the two sheets agree even
  // when filters or rejected registrations are in play.
  const total_billable = rows.reduce((s, r) => s + r.total_inr, 0);
  const total_effective = Math.max(0, total_billable - total_waived);
  const waived_n = rows.filter((r) => r.waived_inr > 0).length;
  // % collected = real money / effective billable. Waivers don't dilute
  // the rate — a fully waived field reads as 100% collected.
  const percent_paid =
    total_effective > 0
      ? Math.min(100, (total_received / total_effective) * 100)
      : 100;

  return {
    rows,
    totals: {
      total_athletes,
      total_billable,
      total_received,
      total_waived,
      total_effective,
      total_paid,
      total_due,
      waived_n,
      percent_paid,
    },
  };
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
      "id, chest_no, full_name, gender, dob, mobile, division, district, team, declared_weight_kg, age_categories, para_codes, para_hand, nonpara_classes, nonpara_hands, nonpara_hand, weight_overrides, status, lifecycle_status, discipline_status, checkin_status"
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
      .select("registration_id, measured_kg, registrations!inner(event_id)")
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
      measured_kg: (w.measured_kg as number | null) ?? null,
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
  // Build category groupings directly from registrations + latest
  // weigh-ins (mirrors `/api/pdf/category` and the on-screen preview).
  // Independent of the `entries` table so the XLSX works at any point
  // in the event lifecycle, including before fixtures are generated and
  // for categories with a single athlete (which never produce fixture
  // rows). Previously this queried `entries` and silently returned an
  // empty workbook when no fixtures existed, even though dozens of
  // athletes had already weighed in.
  const [eventRes, regsRes, wisRes] = await Promise.all([
    svc.from("events").select("starts_at").eq("id", eventId).maybeSingle(),
    svc
      .from("registrations")
      .select(
        "id, chest_no, full_name, district, declared_weight_kg, gender, nonpara_classes, nonpara_hands, nonpara_hand, para_codes, para_hand, weight_overrides, status, lifecycle_status, discipline_status, checkin_status",
      )
      .eq("event_id", eventId),
    svc
      .from("weigh_ins")
      .select(
        "registration_id, measured_kg, weighed_at, registrations!inner(event_id)",
      )
      .eq("registrations.event_id", eventId)
      .order("weighed_at", { ascending: false }),
  ]);
  if (eventRes.error) throw new Error(eventRes.error.message);
  if (regsRes.error) throw new Error(regsRes.error.message);
  if (wisRes.error) throw new Error(wisRes.error.message);

  // Two gates: weighed-in (locks the bucket) AND not disqualified.
  const eligible = (regsRes.data ?? []).filter(
    (r) =>
      r.checkin_status === "weighed_in" &&
      r.discipline_status !== "disqualified" &&
      (r.gender === "M" || r.gender === "F"),
  );
  const latestWi = new Map<string, { measured_kg: number }>();
  for (const w of wisRes.data ?? []) {
    const rid = w.registration_id as string;
    if (!latestWi.has(rid)) {
      latestWi.set(rid, { measured_kg: Number(w.measured_kg) });
    }
  }
  const refYear = eventRes.data?.starts_at
    ? new Date(eventRes.data.starts_at as string).getUTCFullYear()
    : new Date().getUTCFullYear();
  const groupRegs: CategoryGroupReg[] = eligible.map((r) => {
    const lite: RegistrationLite = {
      id: r.id as string,
      gender: r.gender as "M" | "F",
      declared_weight_kg: Number(r.declared_weight_kg ?? 0),
      nonpara_classes: (r.nonpara_classes as string[] | null) ?? [],
      nonpara_hands:
        (r.nonpara_hands as RegistrationLite["nonpara_hands"]) ??
        ((r.nonpara_classes as string[] | null) ?? []).map(
          () => (r.nonpara_hand as "R" | "L" | "B" | null) ?? null,
        ),
      para_codes: (r.para_codes as string[] | null) ?? [],
      para_hand: (r.para_hand as RegistrationLite["para_hand"]) ?? null,
      weight_overrides:
        (r.weight_overrides as RegistrationLite["weight_overrides"]) ?? null,
    };
    return {
      ...lite,
      chest_no: r.chest_no as number | null,
      full_name: r.full_name as string | null,
      district: r.district as string | null,
    };
  });
  return groupRegistrationsByCategory(groupRegs, latestWi, refYear);
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

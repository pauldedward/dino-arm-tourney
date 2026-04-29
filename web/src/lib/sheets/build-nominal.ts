/**
 * Pure mapper from raw Supabase rows → NominalRow shape used by both the
 * PDF and the XLSX exports. Extracted so the paid/weighed derivation
 * logic is unit-testable without a live database.
 */
import type { NominalRow } from "@/lib/pdf/NominalSheet";
import { isPaid, isWeighed } from "@/lib/payments/status";
import { buildOverrideRows } from "@/lib/rules/weight-overrides";
import type { WeightOverride } from "@/lib/rules/resolve";

export interface RegInput {
  id: string;
  chest_no: number | null;
  full_name: string | null;
  gender: string | null;
  dob: string | null;
  mobile: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  age_categories: string[] | null;
  para_codes?: string[] | null;
  para_hand?: "R" | "L" | "B" | null;
  nonpara_classes?: string[] | null;
  nonpara_hands?: Array<"R" | "L" | "B" | null> | null;
  nonpara_hand?: "R" | "L" | "B" | null;
  weight_overrides?: WeightOverride[] | null;
  status: string;
  lifecycle_status?: string | null;
  discipline_status?: string | null;
  checkin_status?: string | null;
}

export interface SummaryInput {
  registration_id: string;
  derived_status: string;
}

export interface WeighInInput {
  registration_id: string;
  measured_kg?: number | null;
}

/**
 * Derive the human-readable status shown on the Nominal Roll. The raw
 * `registrations.status` column is a deprecated denormalised mirror
 * (see migration 0039) and can hold legacy values like "pending" /
 * "approved" that don't match operator vocabulary. The split fields
 * `lifecycle_status` + `discipline_status` are the source of truth.
 */
function deriveDisplayStatus(r: RegInput): string {
  if (r.discipline_status === "disqualified" || r.status === "disqualified")
    return "Disqualified";
  if (r.lifecycle_status === "withdrawn" || r.status === "withdrawn")
    return "Withdrawn";
  return "Active";
}

export function buildNominalRows(
  regs: ReadonlyArray<RegInput>,
  summaries: ReadonlyArray<SummaryInput>,
  weighIns: ReadonlyArray<WeighInInput>,
): NominalRow[] {
  // Index payment-summary rows so each reg lookup is O(1). A reg can
  // technically have multiple payments rows (rare); mark paid if any
  // is verified.
  const paidRegIds = new Set<string>();
  for (const s of summaries) {
    if (s.derived_status === "verified") paidRegIds.add(s.registration_id);
  }
  const weighedRegIds = new Set<string>();
  const measuredKgByReg = new Map<string, number>();
  for (const w of weighIns) {
    weighedRegIds.add(w.registration_id);
    if (typeof w.measured_kg === "number") {
      measuredKgByReg.set(w.registration_id, w.measured_kg);
    }
  }

  return regs.map((r) => {
    const synthPayments = paidRegIds.has(r.id)
      ? [{ status: "verified" as const }]
      : [];
    const hasWeighIn = weighedRegIds.has(r.id);
    const weighed =
      hasWeighIn ||
      isWeighed(r.status, [], r.checkin_status);
    const baseCats = (r.age_categories ?? []).filter(
      (c) => c.toUpperCase() !== "PARA",
    );
    const paraCodes = (r.para_codes ?? []).filter(Boolean);
    const ageCategories = [...baseCats, ...paraCodes];
    // Resolve weight buckets per entry — use the actual weighed-in
    // weight when available so the printed sheet reflects the real
    // category an athlete will compete in.
    const refWeight =
      measuredKgByReg.get(r.id) ?? r.declared_weight_kg ?? 0;
    const overrideRows = buildOverrideRows(
      {
        gender: (r.gender as "M" | "F" | null) ?? null,
        nonpara_classes: r.nonpara_classes ?? [],
        nonpara_hands:
          (r.nonpara_hands && r.nonpara_hands.length > 0
            ? r.nonpara_hands
            : (r.nonpara_classes ?? []).map(() => r.nonpara_hand ?? null)) ?? [],
        para_codes: r.para_codes ?? [],
        para_hand: r.para_hand ?? null,
        weight_overrides: r.weight_overrides ?? [],
      },
      refWeight,
    );
    // Collapse R/L of a "B" hand into a single label per (scope,code).
    const seen = new Set<string>();
    const weight_classes: string[] = [];
    for (const row of overrideRows) {
      const k = `${row.scope}|${row.code}`;
      if (seen.has(k)) continue;
      seen.add(k);
      weight_classes.push(row.selectedBucket.label + (row.competingUp ? " ↑" : ""));
    }
    return {
      chest_no: r.chest_no,
      full_name: r.full_name,
      gender: r.gender,
      dob: r.dob,
      mobile: r.mobile,
      division: r.division,
      district: r.district,
      team: r.team,
      declared_weight_kg: r.declared_weight_kg,
      age_categories: ageCategories,
      weight_classes,
      status: deriveDisplayStatus(r),
      paid: isPaid(r.status, synthPayments, {
        lifecycleStatus: r.lifecycle_status ?? null,
        disciplineStatus: r.discipline_status ?? null,
      }),
      weighed,
    };
  });
}

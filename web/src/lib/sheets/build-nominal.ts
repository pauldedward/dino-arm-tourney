/**
 * Pure mapper from raw Supabase rows → NominalRow shape used by both the
 * PDF and the XLSX exports. Extracted so the paid/weighed derivation
 * logic is unit-testable without a live database.
 */
import type { NominalRow } from "@/lib/pdf/NominalSheet";
import { isPaid, isWeighed } from "@/lib/payments/status";

export interface RegInput {
  id: string;
  chest_no: number | null;
  full_name: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  age_categories: string[] | null;
  status: string;
  checkin_status?: string | null;
}

export interface SummaryInput {
  registration_id: string;
  derived_status: string;
}

export interface WeighInInput {
  registration_id: string;
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
  for (const w of weighIns) weighedRegIds.add(w.registration_id);

  return regs.map((r) => {
    // Synthesize a payments[] for isPaid: if payment_summary says
    // verified, we feed one verified row; otherwise none. This way the
    // helper's withdrawn-suppression and legacy-fallback rules apply
    // uniformly without copy-pasting the logic here.
    const synthPayments = paidRegIds.has(r.id)
      ? [{ status: "verified" as const }]
      : [];
    // Weighed is the union of all three signals so a stale checkin_status
    // can never hide a real weigh_ins row, and a stale weigh_ins row
    // cannot resurrect an athlete who was reset to not_arrived. We
    // delegate to the helper twice and OR — cheaper than re-implementing.
    const hasWeighIn = weighedRegIds.has(r.id);
    const weighed =
      hasWeighIn ||
      isWeighed(r.status, [], r.checkin_status);
    return {
      chest_no: r.chest_no,
      full_name: r.full_name,
      division: r.division,
      district: r.district,
      team: r.team,
      declared_weight_kg: r.declared_weight_kg,
      age_categories: r.age_categories,
      status: r.status,
      paid: isPaid(r.status, synthPayments),
      weighed,
    };
  });
}

/**
 * Per-district roll-up of the Payment Report rows.
 *
 * Pure function over the same `PaymentReportRow[]` that drives the PDF
 * + XLSX athlete tables, so the district summary cannot drift from the
 * athlete list it summarises. Used by the multi-sheet XLSX export and
 * the "district summary" cover section of the Payment Report PDF.
 */
import type { PaymentReportRow } from "@/lib/pdf/PaymentReportSheet";

export interface DistrictRollup {
  district: string;
  athletes_n: number;
  total_billable: number;
  total_received: number;
  total_waived: number;
  /** total_billable − total_waived, never negative. */
  total_effective: number;
  /** Sum of due_inr (outstanding on still-pending payments). */
  total_due: number;
  /** received / effective × 100, capped at 100. 100 when effective is 0. */
  percent_collected: number;
}

const NO_DISTRICT = "(no district)";

export function rollupByDistrict(
  rows: readonly PaymentReportRow[]
): DistrictRollup[] {
  const map = new Map<
    string,
    {
      athletes_n: number;
      total_billable: number;
      total_received: number;
      total_waived: number;
      total_due: number;
    }
  >();
  for (const r of rows) {
    const key = (r.team_or_district ?? "").trim() || NO_DISTRICT;
    let g = map.get(key);
    if (!g) {
      g = {
        athletes_n: 0,
        total_billable: 0,
        total_received: 0,
        total_waived: 0,
        total_due: 0,
      };
      map.set(key, g);
    }
    g.athletes_n += 1;
    g.total_billable += r.total_inr;
    g.total_received += r.received_inr;
    g.total_waived += r.waived_inr;
    g.total_due += r.due_inr;
  }
  return [...map.entries()]
    .map(([district, v]) => {
      const total_effective = Math.max(0, v.total_billable - v.total_waived);
      const percent_collected =
        total_effective > 0
          ? Math.min(100, (v.total_received / total_effective) * 100)
          : 100;
      return {
        district,
        athletes_n: v.athletes_n,
        total_billable: v.total_billable,
        total_received: v.total_received,
        total_waived: v.total_waived,
        total_effective,
        total_due: v.total_due,
        percent_collected,
      };
    })
    .sort((a, b) => a.district.localeCompare(b.district));
}

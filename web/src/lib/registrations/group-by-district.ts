/**
 * Pure aggregation helpers for the operator console's "By district" view.
 *
 * Extracted out of `FastRegistrationsTable` so the grouping + money math
 * is unit-testable without rendering React. The component imports
 * `groupRowsByDistrict` and uses the result to render its sticky group
 * headers.
 */

export type GroupablePayment = {
  id: string;
  status: "pending" | "verified" | "rejected";
  amount_inr: number | null;
  /**
   * Sum of active payment_collections for this payment. Defaults to
   * `amount_inr` when verified / 0 otherwise so legacy callers that
   * predate installments still get the right group totals.
   */
  collected_inr?: number | null;
  /** Total − collected, never negative. Defaults to `amount_inr` for
   *  pending / 0 for verified. */
  remaining_inr?: number | null;
};

export type GroupableRow = {
  id: string;
  district: string | null;
  team: string | null;
  /** Latest payment for this registration. The component already
   * normalises the supabase nested array into a single object. */
  payment: GroupablePayment | null;
};

export type DistrictGroup<R extends GroupableRow = GroupableRow> = {
  /** Stable key for React reconciliation. Falls back to "—" when neither
   * district nor team is set so rows aren't silently dropped. */
  key: string;
  label: string;
  rows: R[];
  /** Sum of `amount_inr` across rows whose payment is verified. */
  collectedInr: number;
  /** Sum of `amount_inr` across rows whose payment is pending. Drives
   * the "Collect ₹X" bulk button on the group header. */
  pendingInr: number;
  /** Pending payment objects so the bulk-collect popover can issue one
   * server call with all the ids. */
  collectablePayments: GroupablePayment[];
};

export function groupRowsByDistrict<R extends GroupableRow>(
  rows: R[]
): DistrictGroup<R>[] {
  const map = new Map<string, DistrictGroup<R>>();
  for (const r of rows) {
    const key = (r.district ?? r.team ?? "—") || "—";
    const label = r.district ?? (r.team ? `Team · ${r.team}` : "—");
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label,
        rows: [],
        collectedInr: 0,
        pendingInr: 0,
        collectablePayments: [],
      };
      map.set(key, g);
    }
    g.rows.push(r);
    const p = r.payment;
    if (p) {
      const total = p.amount_inr ?? 0;
      const collected =
        p.collected_inr ?? (p.status === "verified" ? total : 0);
      const remaining =
        p.remaining_inr ?? Math.max(0, total - collected);
      // Verified payments contribute to collected only.
      // Pending (incl. partial) contribute their *remaining* to pending
      // AND any already-collected portion to collected, so the group
      // header is honest about money in the till vs money still owed.
      g.collectedInr += collected;
      if (p.status === "pending") {
        g.pendingInr += remaining;
        if (remaining > 0) g.collectablePayments.push(p);
      }
      // 'rejected' contributes to neither bucket — by design, those are
      // surfaced separately via the "rejected" payment filter.
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

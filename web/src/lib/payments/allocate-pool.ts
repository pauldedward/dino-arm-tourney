/**
 * Greedy oldest-first allocator for "district treasurer dropped a pool of
 * ₹X — spread it across the still-pending athletes from this district".
 *
 * Pure / side-effect-free so it can be unit-tested cheaply and called
 * from the bulk collect endpoint with the same logic the UI uses to
 * preview the outcome before confirming.
 *
 * Inputs are already sorted by the caller (oldest first by registration
 * created_at). The allocator just walks the list and consumes the pool.
 */

export interface PoolPaymentInput {
  /** Stable id used by the caller to match the result back to its row. */
  id: string;
  /** Remaining (unpaid) amount on this payment. Negative / zero means
   *  the row is already fully covered and should be skipped. */
  remaining_inr: number;
}

export interface PoolAllocation {
  id: string;
  amount_inr: number;
  /** True iff this payment is now fully covered after the allocation. */
  fully_covered: boolean;
}

export interface PoolAllocationResult {
  /** Per-payment allocations, in input order. Includes only the rows
   *  that received > 0 from the pool. */
  allocations: PoolAllocation[];
  /** Pool that wasn't spent (pool > total remaining). */
  leftover_inr: number;
  /** Rows the pool never reached because it ran out first. */
  untouched_ids: string[];
  /** Rows that got something but not enough to fully cover. At most one
   *  in a typical run (the boundary athlete). */
  partial_ids: string[];
  /** Rows fully covered by their allocation. */
  fully_ids: string[];
}

export function allocatePool(
  pool: number,
  payments: readonly PoolPaymentInput[]
): PoolAllocationResult {
  const allocations: PoolAllocation[] = [];
  const untouched: string[] = [];
  const partial: string[] = [];
  const fully: string[] = [];
  let remaining = Math.max(0, Math.floor(pool));

  for (const p of payments) {
    const owe = Math.max(0, Math.floor(p.remaining_inr));
    if (owe === 0) continue; // already paid; skip silently
    if (remaining === 0) {
      untouched.push(p.id);
      continue;
    }
    const take = Math.min(remaining, owe);
    remaining -= take;
    allocations.push({
      id: p.id,
      amount_inr: take,
      fully_covered: take >= owe,
    });
    if (take >= owe) fully.push(p.id);
    else partial.push(p.id);
  }

  return {
    allocations,
    leftover_inr: remaining,
    untouched_ids: untouched,
    partial_ids: partial,
    fully_ids: fully,
  };
}

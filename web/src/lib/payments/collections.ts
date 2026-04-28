/**
 * Pure helpers for partial / installment payment collection.
 *
 * The `payments` table holds one row per registration with `amount_inr`
 * (the total fee owed). The `payment_collections` table holds zero or
 * more installments per payment — each can be cash, UPI, or a waiver
 * (used for "concession the remainder"). A collection can be soft-
 * reversed (`reversed_at` set) when an operator undoes a verification.
 *
 * Keep this module side-effect-free so it can be unit-tested cheaply
 * and re-used from both the API routes and the UI for "preview the
 * resulting status before confirming".
 */

export interface CollectionLike {
  amount_inr: number;
  reversed_at: string | null;
}

export interface PaymentSummary {
  /** Total fee owed (mutable via adjust-total). */
  total_inr: number;
  /** Sum of active (non-reversed) collections. */
  collected_inr: number;
  /** total - collected, never negative. */
  remaining_inr: number;
  /** True iff collected >= total AND total > 0. */
  fully_collected: boolean;
  /** Convenience for derivation. Mirrors payments.status (excluding 'rejected'). */
  derived_status: "pending" | "verified";
}

/**
 * Fold a list of collections into a snapshot.
 *
 * - Reversed collections are excluded from the sum.
 * - A zero-fee payment (total = 0) is *not* fully_collected unless
 *   there's at least one explicit collection covering it. This prevents
 *   accidentally treating a brand-new ₹0 payment as paid before the
 *   operator ever touches it. (In practice, ₹0 payments only occur on
 *   waiver inserts, which always create a corresponding collection.)
 */
export function summarisePayment(
  totalInr: number,
  collections: readonly CollectionLike[]
): PaymentSummary {
  const total = Math.max(0, Math.floor(totalInr));
  const collected = collections.reduce(
    (s, c) => (c.reversed_at ? s : s + Math.max(0, c.amount_inr)),
    0
  );
  const remaining = Math.max(0, total - collected);
  const fully = total > 0 && collected >= total;
  return {
    total_inr: total,
    collected_inr: collected,
    remaining_inr: remaining,
    fully_collected: fully,
    derived_status: fully ? "verified" : "pending",
  };
}

/**
 * Plan the collection rows that should be inserted when an operator
 * submits the "collect" popover. Returns either:
 *   - an array of zero, one, or two rows to insert; or
 *   - a validation error.
 *
 * Inputs are all client-provided so this function double-checks them
 * (the route also validates, but keeping the rules here means the UI
 * can call this for an instant preview).
 */
export interface CollectIntent {
  method: "cash" | "manual_upi" | "waiver";
  /** Amount the operator says they collected. Clamped to remaining. */
  amount_inr: number;
  /** When true, also write a waiver collection covering the rest. */
  waive_remainder: boolean;
  /** Optional free-text note (receipt #, UTR, "DC bundle"). */
  reference: string | null;
}

export interface PlannedCollection {
  amount_inr: number;
  method: "cash" | "manual_upi" | "waiver";
  reference: string | null;
}

export type CollectPlan =
  | { ok: true; rows: PlannedCollection[] }
  | { ok: false; error: string };

export function planCollection(
  summary: PaymentSummary,
  intent: CollectIntent
): CollectPlan {
  if (!Number.isFinite(intent.amount_inr) || intent.amount_inr < 0) {
    return { ok: false, error: "amount must be a non-negative number" };
  }
  if (summary.remaining_inr <= 0) {
    return { ok: false, error: "payment is already fully collected" };
  }

  // Clamp the requested amount to what's still owed — the UI may have
  // raced with another desk that collected concurrently.
  const amount = Math.min(
    Math.floor(intent.amount_inr),
    summary.remaining_inr
  );

  // Waiver method fully covers whatever's left, ignoring the typed
  // amount (the UI hides the input in this case anyway).
  if (intent.method === "waiver") {
    return {
      ok: true,
      rows: [
        {
          amount_inr: summary.remaining_inr,
          method: "waiver",
          reference: intent.reference,
        },
      ],
    };
  }

  if (amount === 0 && !intent.waive_remainder) {
    return { ok: false, error: "amount must be greater than zero" };
  }

  const rows: PlannedCollection[] = [];
  if (amount > 0) {
    rows.push({
      amount_inr: amount,
      method: intent.method,
      reference: intent.reference,
    });
  }

  if (intent.waive_remainder) {
    const waiverAmount = summary.remaining_inr - amount;
    if (waiverAmount > 0) {
      rows.push({
        amount_inr: waiverAmount,
        method: "waiver",
        reference: intent.reference,
      });
    }
  }

  return { ok: true, rows };
}

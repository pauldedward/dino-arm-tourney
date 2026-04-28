/**
 * Payment / weigh-in status helpers.
 *
 * Single source of truth for "is this athlete paid?" and "did they weigh in?"
 * Replaces the historical conflation between `registrations.status` and
 * `payments.status` that produced inconsistent results across the operator
 * console, sheets, PDFs, and athlete-facing pages.
 *
 * Rules:
 *  - **Paid** = any non-reversed payment row has status `verified`. We still
 *    fall back to the legacy `registrations.status in ('paid','weighed_in')`
 *    so rows written before the payments table existed (or by the bulk-row
 *    writer that mirrors both fields) keep working until the schema split
 *    migration lands.
 *  - **Weighed** = at least one row in `weigh_ins`. Fall back to the legacy
 *    `registrations.status = 'weighed_in'` for the same reason.
 *  - **Withdrawn / cancelled** registrations are never reported as paid even
 *    if a stale payment row exists; the refund flow is handled separately.
 */

export type RegistrationStatus =
  | "pending"
  | "paid"
  | "weighed_in"
  | "withdrawn"
  | "disqualified"
  | string;

export type PaymentRow = {
  status?: string | null;
  utr?: string | null;
} | null | undefined;

export function isPaid(
  registrationStatus: RegistrationStatus | null | undefined,
  payments: ReadonlyArray<PaymentRow> | null | undefined,
): boolean {
  if (
    registrationStatus === "withdrawn" ||
    registrationStatus === "disqualified"
  ) {
    return false;
  }
  const list = payments ?? [];
  if (list.some((p) => p?.status === "verified")) return true;
  return (
    registrationStatus === "paid" || registrationStatus === "weighed_in"
  );
}

export type CheckinStatus = "not_arrived" | "weighed_in" | "no_show" | string;

export function isWeighed(
  registrationStatus: RegistrationStatus | null | undefined,
  weighIns: ReadonlyArray<{ id?: string | null } | null | undefined> | null | undefined,
  checkinStatus?: CheckinStatus | null,
): boolean {
  // checkin_status (added in 0029) is the post-migration source of
  // truth. When a caller passes it, trust it absolutely — the trigger
  // on weigh_ins keeps it in lockstep with the weigh_ins table.
  if (checkinStatus !== undefined && checkinStatus !== null) {
    return checkinStatus === "weighed_in";
  }
  if (weighIns && weighIns.length > 0) return true;
  return registrationStatus === "weighed_in";
}

export type PaymentTone = "ok" | "bad" | "warn" | "muted";

export function paymentDisplay(
  payment: PaymentRow,
): { label: string; tone: PaymentTone } {
  if (!payment) return { label: "—", tone: "muted" };
  if (payment.status === "verified") return { label: "verified", tone: "ok" };
  if (payment.status === "rejected") return { label: "rejected", tone: "bad" };
  if (payment.utr) return { label: "review", tone: "warn" };
  return { label: "pending", tone: "muted" };
}

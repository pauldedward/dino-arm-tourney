/**
 * Status helpers — one source of truth for "paid?", "weighed?",
 * "withdrawn?", "disqualified?" across the entire app.
 *
 * Post-0039 the schema has dedicated columns per axis:
 *   - registrations.lifecycle_status   active | withdrawn
 *   - registrations.discipline_status  clear  | disqualified
 *   - registrations.checkin_status     not_arrived | weighed_in | no_show
 *   - payment_summary.derived_status   pending | verified | rejected | …
 *
 * The legacy `registrations.status` column is kept as a deprecated mirror.
 * These helpers tolerate it (`legacyStatus` arg) only for the lifecycle and
 * discipline tokens (`withdrawn`, `disqualified`) so unmigrated rows still
 * render correctly. They no longer treat `paid` or `weighed_in` on the
 * legacy column as truth — those signals now live on the dedicated columns.
 */

export type LifecycleStatus = "active" | "withdrawn";
export type DisciplineStatus = "clear" | "disqualified";
export type CheckinStatus = "not_arrived" | "weighed_in" | "no_show";
export type DerivedPaymentStatus =
  | "pending"
  | "verified"
  | "rejected"
  | "reversed"
  | string;

/** Legacy union — retained for back-compat with code that types vars. */
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

/* ---------- Lifecycle / discipline predicates ---------- */

export function isWithdrawn(
  lifecycleStatus?: string | null,
  legacyStatus?: string | null,
): boolean {
  if (lifecycleStatus === "withdrawn") return true;
  // Pre-0039 row whose only signal is the deprecated mirror.
  if (!lifecycleStatus && legacyStatus === "withdrawn") return true;
  return false;
}

export function isDisqualified(
  disciplineStatus?: string | null,
  legacyStatus?: string | null,
): boolean {
  if (disciplineStatus === "disqualified") return true;
  if (!disciplineStatus && legacyStatus === "disqualified") return true;
  return false;
}

export function isCompeting(opts: {
  lifecycleStatus?: string | null;
  disciplineStatus?: string | null;
  legacyStatus?: string | null;
}): boolean {
  return (
    !isWithdrawn(opts.lifecycleStatus, opts.legacyStatus) &&
    !isDisqualified(opts.disciplineStatus, opts.legacyStatus)
  );
}

/* ---------- Paid ---------- */

export interface IsPaidOpts {
  lifecycleStatus?: string | null;
  disciplineStatus?: string | null;
  /** payment_summary.derived_status — preferred over scanning payments[]. */
  derivedPaymentStatus?: string | null;
}

/**
 * Paid = athlete has a verified payment AND is still competing.
 *
 * Callers can pass either a derived `payment_summary.derived_status` via
 * `opts.derivedPaymentStatus` (preferred) or a `payments[]` snapshot.
 * Withdrawn / DQ'd athletes are never reported as paid.
 */
export function isPaid(
  legacyStatus: RegistrationStatus | null | undefined,
  payments: ReadonlyArray<PaymentRow> | null | undefined,
  opts: IsPaidOpts = {},
): boolean {
  if (
    !isCompeting({
      lifecycleStatus: opts.lifecycleStatus,
      disciplineStatus: opts.disciplineStatus,
      legacyStatus,
    })
  ) {
    return false;
  }
  if (opts.derivedPaymentStatus === "verified") return true;
  const list = payments ?? [];
  if (list.some((p) => p?.status === "verified")) return true;
  return false;
}

/* ---------- Weighed ---------- */

export function isWeighed(
  _legacyStatus: RegistrationStatus | null | undefined,
  weighIns: ReadonlyArray<{ id?: string | null } | null | undefined> | null | undefined,
  checkinStatus?: CheckinStatus | string | null,
): boolean {
  // checkin_status is the post-0029 source of truth — trigger on
  // weigh_ins keeps it in lockstep.
  if (checkinStatus !== undefined && checkinStatus !== null) {
    return checkinStatus === "weighed_in";
  }
  if (weighIns && weighIns.length > 0) return true;
  return false;
}

/* ---------- Display helper for payment chips ---------- */

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

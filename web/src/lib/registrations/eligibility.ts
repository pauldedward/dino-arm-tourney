/**
 * "Is this athlete eligible for fixture/category-sheet inclusion?"
 *
 * Post-0039 each axis has its own column. Eligibility is:
 *
 *   competing  = lifecycle_status = 'active' AND discipline_status = 'clear'
 *   paid       = payment_summary.derived_status = 'verified'
 *   weighed-in = checkin_status = 'weighed_in'
 *   eligible   = competing AND (paid OR weighed-in)
 *
 * Pre-0039 callers can still pass the legacy `regStatus` mirror; the
 * helper falls back to it for `withdrawn` / `disqualified` only.
 */
import { isPaid, isWeighed, isCompeting } from "@/lib/payments/status";

export interface FixtureEligibilityInput {
  regStatus?: string | null;
  lifecycleStatus?: string | null;
  disciplineStatus?: string | null;
  derivedPaymentStatus?: string | null;
  checkinStatus?: string | null;
}

export function isFixtureEligible(input: FixtureEligibilityInput): boolean {
  const {
    regStatus,
    lifecycleStatus,
    disciplineStatus,
    derivedPaymentStatus,
    checkinStatus,
  } = input;
  if (
    !isCompeting({
      lifecycleStatus,
      disciplineStatus,
      legacyStatus: regStatus,
    })
  ) {
    return false;
  }
  const paid = isPaid(regStatus, null, {
    lifecycleStatus,
    disciplineStatus,
    derivedPaymentStatus,
  });
  const weighed = isWeighed(regStatus, null, checkinStatus);
  return paid || weighed;
}

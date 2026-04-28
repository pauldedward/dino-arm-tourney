/**
 * "Is this athlete eligible for fixture/category-sheet inclusion?"
 *
 * Replaces the legacy `.in("status", ["paid","weighed_in"])` filter,
 * which under-counted athletes who completed payment via installments
 * (`payment_collections`). Those rows have `payment_summary.derived_status
 * = 'verified'` but the legacy `registrations.status` stays `pending`,
 * because the only writers that flip the mirror are the direct-payment
 * routes, not the collection insert paths.
 *
 * Eligibility = (paid OR already-weighed-in) AND not-withdrawn-or-DQ'd.
 *
 *   paid            ← legacy mirror in ('paid','weighed_in')
 *                     OR payment_summary.derived_status = 'verified'
 *   weighed-in      ← legacy mirror = 'weighed_in'
 *                     OR checkin_status = 'weighed_in'
 *   disqualifying   ← lifecycle/discipline status (withdrawn, disqualified)
 */
import { isPaid, isWeighed } from "@/lib/payments/status";

export interface FixtureEligibilityInput {
  regStatus: string | null | undefined;
  derivedPaymentStatus: string | null | undefined;
  checkinStatus: string | null | undefined;
}

export function isFixtureEligible(input: FixtureEligibilityInput): boolean {
  const { regStatus, derivedPaymentStatus, checkinStatus } = input;
  // isPaid handles withdrawn/disqualified suppression already.
  const synthPayments =
    derivedPaymentStatus === "verified"
      ? [{ status: "verified" as const }]
      : derivedPaymentStatus
        ? [{ status: derivedPaymentStatus }]
        : [];
  const paid = isPaid(regStatus, synthPayments);
  const weighed = isWeighed(regStatus, null, checkinStatus);
  // Same withdrawn/disqualified guard as isPaid; isWeighed deliberately
  // doesn't apply it because a DQ'd athlete may still need to appear in
  // the weigh-in audit trail. For fixture inclusion we exclude them.
  if (regStatus === "withdrawn" || regStatus === "disqualified") return false;
  return paid || weighed;
}

/**
 * Derive age-band codes from DOB + event start date.
 * Returns the subset the athlete is *automatically* eligible for.
 * The form lets them also opt into Senior on top of a youth band.
 */
import { ageOnMatchDay, eligibleBands } from "@/lib/rules";

export function deriveAgeCategories(
  dob: string,
  eventStartsAt: string | Date,
  opts: { includeSenior?: boolean } = {}
): string[] {
  const age = ageOnMatchDay(dob, eventStartsAt);
  const bands = eligibleBands(age).map((b) => b.code);
  if (opts.includeSenior && !bands.includes("Senior") && age >= 16) {
    bands.push("Senior");
  }
  return bands;
}

/** Mask an aadhaar string to the last-4 form ("XXXX-XXXX-1234"). */
export function maskAadhaar(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return null;
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

/** UPI deep-link for payment QR. Handles amount + payee name encoding. */
export function buildUpiUri(params: {
  upiId: string;
  payeeName: string;
  amountInr: number;
  note: string;
}): string {
  const qs = new URLSearchParams({
    pa: params.upiId,
    pn: params.payeeName,
    am: params.amountInr.toFixed(2),
    cu: "INR",
    tn: params.note,
  });
  return `upi://pay?${qs.toString()}`;
}

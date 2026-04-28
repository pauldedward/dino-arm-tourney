/**
 * WAF 2025 age categories (official chart).
 *
 * Min/max are inclusive years on the event start date. `null` upper bound
 * means open-ended. Per WAF 2025, the Senior/Master/Grand Master/Senior
 * Grand Master/Super Senior Grand Master bands all extend to "+" (no upper
 * bound) — an athlete in their 50s is Senior + Master + Grand Master and
 * may compete in any of those at registration time.
 *
 * An athlete's DOB resolves to ALL bands they qualify for. Para juniors
 * (14–23) are resolved separately by `wafCategoriesFor` in `waf-2025.ts`.
 */
export const AGE_BANDS = [
  { code: "SubJunior",              label: "Sub-Junior 15",             minAge: 14, maxAge: 15 },
  { code: "Junior",                 label: "Junior 18",                 minAge: 16, maxAge: 18 },
  { code: "Youth",                  label: "Youth 23",                  minAge: 19, maxAge: 23 },
  { code: "Senior",                 label: "Senior",                    minAge: 19, maxAge: null },
  { code: "Master",                 label: "Master",                    minAge: 40, maxAge: null },
  { code: "GrandMaster",            label: "Grand Master",              minAge: 50, maxAge: null },
  { code: "SeniorGrandMaster",      label: "Senior Grand Master",       minAge: 60, maxAge: null },
  { code: "SuperSeniorGrandMaster", label: "Super Senior Grand Master", minAge: 70, maxAge: null },
] as const;

export type AgeBandCode = (typeof AGE_BANDS)[number]["code"];

/** Age in years on a reference date (defaults to today). */
export function ageOn(dob: Date, refDate: Date = new Date()): number {
  let age = refDate.getFullYear() - dob.getFullYear();
  const m = refDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < dob.getDate())) age--;
  return age;
}

/** All age bands an athlete with this DOB qualifies for. */
export function bandsForDob(dob: Date, refDate: Date = new Date()): AgeBandCode[] {
  const a = ageOn(dob, refDate);
  return AGE_BANDS.filter(
    (b) => a >= b.minAge && (b.maxAge === null || a <= b.maxAge)
  ).map((b) => b.code);
}

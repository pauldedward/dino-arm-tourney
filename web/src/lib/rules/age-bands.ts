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
export type AgeBandGroup = "youth" | "senior" | "master";

export interface AgeBand {
  code: string;
  label: string;
  minAge: number;
  maxAge: number | null;
  group: AgeBandGroup;
}

export const AGE_BANDS: readonly AgeBand[] = [
  { code: "SubJunior",              label: "Sub-Junior 15",             minAge: 14, maxAge: 15,   group: "youth"  },
  { code: "Junior",                 label: "Junior 18",                 minAge: 16, maxAge: 18,   group: "youth"  },
  { code: "Youth",                  label: "Youth 23",                  minAge: 19, maxAge: 23,   group: "youth"  },
  { code: "Senior",                 label: "Senior",                    minAge: 19, maxAge: null, group: "senior" },
  { code: "Master",                 label: "Master",                    minAge: 40, maxAge: null, group: "master" },
  { code: "GrandMaster",            label: "Grand Master",              minAge: 50, maxAge: null, group: "master" },
  { code: "SeniorGrandMaster",      label: "Senior Grand Master",       minAge: 60, maxAge: null, group: "master" },
  { code: "SuperSeniorGrandMaster", label: "Super Senior Grand Master", minAge: 70, maxAge: null, group: "master" },
] as const;

export type AgeBandCode = (typeof AGE_BANDS)[number]["code"];

/** Age in years on a reference date (defaults to today). */
export function ageOn(dob: Date, refDate: Date = new Date()): number {
  let age = refDate.getFullYear() - dob.getFullYear();
  const m = refDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * Age (in completed years) on 31 December of `refYear`. The PAFI/WAF
 * convention treats whatever age you reach during the calendar year as
 * your competition age, so we always anchor at year-end.
 */
export function ageOnDec31(dob: string, refYear: number): number {
  const y = Number(dob.slice(0, 4));
  if (!Number.isFinite(y)) return Number.NaN;
  return refYear - y;
}

/**
 * Age (in completed years) on the event start date ("match day").
 * Used by the registration flow so age categories reflect the athlete's
 * actual age when they step up to the table, not the year-end convention.
 *
 * `dob` is `YYYY-MM-DD`; `eventStartsAt` is any value `Date` accepts
 * (ISO string from Postgres `timestamptz` works).
 */
export function ageOnMatchDay(dob: string, eventStartsAt: string | Date): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return Number.NaN;
  const dobDate = new Date(`${dob}T00:00:00Z`);
  const event = eventStartsAt instanceof Date ? eventStartsAt : new Date(eventStartsAt);
  if (Number.isNaN(dobDate.getTime()) || Number.isNaN(event.getTime())) return Number.NaN;
  let age = event.getUTCFullYear() - dobDate.getUTCFullYear();
  const m = event.getUTCMonth() - dobDate.getUTCMonth();
  if (m < 0 || (m === 0 && event.getUTCDate() < dobDate.getUTCDate())) age--;
  return age;
}

/** All age bands an athlete of this age qualifies for, in chart order. */
export function eligibleBands(age: number): AgeBand[] {
  return AGE_BANDS.filter(
    (b) => age >= b.minAge && (b.maxAge === null || age <= b.maxAge)
  );
}

/** All age bands an athlete with this DOB qualifies for. */
export function bandsForDob(dob: Date, refDate: Date = new Date()): AgeBandCode[] {
  const a = ageOn(dob, refDate);
  return eligibleBands(a).map((b) => b.code);
}

/**
 * Weight classes used at the Tamil Nadu State Championship.
 *
 * Data is denormalised per (division, ageBand) because youth and senior
 * brackets historically use different upper-weight cut-offs in India
 * (PAFI 2024 schedule).
 *
 * Each class has an inclusive upper bound. An open class (no upper bound)
 * has `upperKg = null`.
 */

export type Division = "Men" | "Women" | "Para Men" | "Para Women";

export interface WeightClass {
  code: string;
  label: string;
  upperKg: number | null;
  division: Division;
  ageGroup: "youth" | "senior" | "master";
}

/** Men — Senior / Master (WAF-aligned). */
const SENIOR_MEN: WeightClass[] = [
  { code: "SM-55",  label: "−55 kg",  upperKg: 55,   division: "Men", ageGroup: "senior" },
  { code: "SM-60",  label: "−60 kg",  upperKg: 60,   division: "Men", ageGroup: "senior" },
  { code: "SM-65",  label: "−65 kg",  upperKg: 65,   division: "Men", ageGroup: "senior" },
  { code: "SM-70",  label: "−70 kg",  upperKg: 70,   division: "Men", ageGroup: "senior" },
  { code: "SM-75",  label: "−75 kg",  upperKg: 75,   division: "Men", ageGroup: "senior" },
  { code: "SM-80",  label: "−80 kg",  upperKg: 80,   division: "Men", ageGroup: "senior" },
  { code: "SM-85",  label: "−85 kg",  upperKg: 85,   division: "Men", ageGroup: "senior" },
  { code: "SM-90",  label: "−90 kg",  upperKg: 90,   division: "Men", ageGroup: "senior" },
  { code: "SM-100", label: "−100 kg", upperKg: 100,  division: "Men", ageGroup: "senior" },
  { code: "SM-110", label: "−110 kg", upperKg: 110,  division: "Men", ageGroup: "senior" },
  { code: "SM-OPN", label: "+110 kg", upperKg: null, division: "Men", ageGroup: "senior" },
];

/** Women — Senior (WAF-aligned). */
const SENIOR_WOMEN: WeightClass[] = [
  { code: "SW-50",  label: "−50 kg",  upperKg: 50,   division: "Women", ageGroup: "senior" },
  { code: "SW-55",  label: "−55 kg",  upperKg: 55,   division: "Women", ageGroup: "senior" },
  { code: "SW-60",  label: "−60 kg",  upperKg: 60,   division: "Women", ageGroup: "senior" },
  { code: "SW-65",  label: "−65 kg",  upperKg: 65,   division: "Women", ageGroup: "senior" },
  { code: "SW-70",  label: "−70 kg",  upperKg: 70,   division: "Women", ageGroup: "senior" },
  { code: "SW-80",  label: "−80 kg",  upperKg: 80,   division: "Women", ageGroup: "senior" },
  { code: "SW-OPN", label: "+80 kg",  upperKg: null, division: "Women", ageGroup: "senior" },
];

/** Youth men (U14/U16/U18/U21 use the same grid). */
const YOUTH_MEN: WeightClass[] = [
  { code: "YM-50",  label: "−50 kg",  upperKg: 50,   division: "Men", ageGroup: "youth" },
  { code: "YM-55",  label: "−55 kg",  upperKg: 55,   division: "Men", ageGroup: "youth" },
  { code: "YM-60",  label: "−60 kg",  upperKg: 60,   division: "Men", ageGroup: "youth" },
  { code: "YM-65",  label: "−65 kg",  upperKg: 65,   division: "Men", ageGroup: "youth" },
  { code: "YM-70",  label: "−70 kg",  upperKg: 70,   division: "Men", ageGroup: "youth" },
  { code: "YM-75",  label: "−75 kg",  upperKg: 75,   division: "Men", ageGroup: "youth" },
  { code: "YM-80",  label: "−80 kg",  upperKg: 80,   division: "Men", ageGroup: "youth" },
  { code: "YM-OPN", label: "+80 kg",  upperKg: null, division: "Men", ageGroup: "youth" },
];

const YOUTH_WOMEN: WeightClass[] = [
  { code: "YW-45",  label: "−45 kg",  upperKg: 45,   division: "Women", ageGroup: "youth" },
  { code: "YW-50",  label: "−50 kg",  upperKg: 50,   division: "Women", ageGroup: "youth" },
  { code: "YW-55",  label: "−55 kg",  upperKg: 55,   division: "Women", ageGroup: "youth" },
  { code: "YW-60",  label: "−60 kg",  upperKg: 60,   division: "Women", ageGroup: "youth" },
  { code: "YW-65",  label: "−65 kg",  upperKg: 65,   division: "Women", ageGroup: "youth" },
  { code: "YW-OPN", label: "+65 kg",  upperKg: null, division: "Women", ageGroup: "youth" },
];

export const WEIGHT_CLASSES: readonly WeightClass[] = [
  ...YOUTH_MEN,
  ...YOUTH_WOMEN,
  ...SENIOR_MEN,
  ...SENIOR_WOMEN,
];

/**
 * Pick the lightest class whose upperKg >= measuredKg for the given
 * division + age group. Returns the open class if athlete is heavier than
 * every bounded class.
 */
export function classifyWeight(
  measuredKg: number,
  division: Division,
  ageGroup: "youth" | "senior" | "master"
): WeightClass | null {
  // Para uses its own grid — handled in para.ts. Masters use senior weights.
  if (division === "Para Men" || division === "Para Women") return null;

  const pool = WEIGHT_CLASSES.filter(
    (c) =>
      c.division === division &&
      c.ageGroup === (ageGroup === "master" ? "senior" : ageGroup)
  );

  const bounded = pool
    .filter((c) => c.upperKg !== null)
    .sort((a, b) => (a.upperKg! - b.upperKg!));

  for (const c of bounded) {
    if (measuredKg <= c.upperKg!) return c;
  }
  return pool.find((c) => c.upperKg === null) ?? null;
}

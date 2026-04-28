/**
 * Weight classes for arm wrestling. We model two rule profiles for week 1:
 *   - WAF-2022 (international, used at WAF/IAFF nationals)
 *   - IAFF-2024 (Indian / Pro Panja League style)
 *
 * For each (rule profile, division, age band) we ship an ordered list of
 * upper-bound buckets in kg. `upperKg = null` means "open / no upper bound".
 *
 * Para classes intentionally use a smaller set of wider buckets (audit §10).
 */

export type Division = "Men" | "Women" | "Para Men" | "Para Women";
export type RuleProfileCode = "WAF-2022" | "IAFF-2024";

export type WeightBucket = {
  code: string;                 // 'M-80', 'W-65', 'PM-80', etc.
  label: string;
  upperKg: number | null;
};

// ── WAF-2022 ───────────────────────────────────────────────────────────────
const WAF_MEN: WeightBucket[] = [
  { code: "M-55",  label: "55 kg",  upperKg: 55 },
  { code: "M-60",  label: "60 kg",  upperKg: 60 },
  { code: "M-65",  label: "65 kg",  upperKg: 65 },
  { code: "M-70",  label: "70 kg",  upperKg: 70 },
  { code: "M-75",  label: "75 kg",  upperKg: 75 },
  { code: "M-80",  label: "80 kg",  upperKg: 80 },
  { code: "M-85",  label: "85 kg",  upperKg: 85 },
  { code: "M-90",  label: "90 kg",  upperKg: 90 },
  { code: "M-100", label: "100 kg", upperKg: 100 },
  { code: "M-110", label: "110 kg", upperKg: 110 },
  { code: "M-110P", label: "+110 kg", upperKg: null },
];
const WAF_WOMEN: WeightBucket[] = [
  { code: "W-50",  label: "50 kg",  upperKg: 50 },
  { code: "W-55",  label: "55 kg",  upperKg: 55 },
  { code: "W-60",  label: "60 kg",  upperKg: 60 },
  { code: "W-65",  label: "65 kg",  upperKg: 65 },
  { code: "W-70",  label: "70 kg",  upperKg: 70 },
  { code: "W-80",  label: "80 kg",  upperKg: 80 },
  { code: "W-90",  label: "90 kg",  upperKg: 90 },
  { code: "W-90P", label: "+90 kg", upperKg: null },
];

// ── IAFF-2024 (Indian) ─────────────────────────────────────────────────────
const IAFF_MEN: WeightBucket[] = [
  { code: "IM-60",  label: "−60 kg",   upperKg: 60 },
  { code: "IM-70",  label: "60–70 kg", upperKg: 70 },
  { code: "IM-80",  label: "70–80 kg", upperKg: 80 },
  { code: "IM-90",  label: "80–90 kg", upperKg: 90 },
  { code: "IM-100", label: "90–100 kg", upperKg: 100 },
  { code: "IM-100P", label: "+100 kg", upperKg: null },
];
const IAFF_WOMEN: WeightBucket[] = [
  { code: "IW-55",  label: "−55 kg",   upperKg: 55 },
  { code: "IW-65",  label: "55–65 kg", upperKg: 65 },
  { code: "IW-65P", label: "+65 kg",   upperKg: null },
];

// ── Para (wider buckets, single-arm by rule) ───────────────────────────────
const PARA_MEN: WeightBucket[] = [
  { code: "PM-70",  label: "−70 kg", upperKg: 70 },
  { code: "PM-80",  label: "70–80 kg", upperKg: 80 },
  { code: "PM-80P", label: "+80 kg", upperKg: null },
];
const PARA_WOMEN: WeightBucket[] = [
  { code: "PW-60",  label: "−60 kg", upperKg: 60 },
  { code: "PW-60P", label: "+60 kg", upperKg: null },
];

export function bucketsFor(
  profile: RuleProfileCode,
  division: Division
): WeightBucket[] {
  if (division === "Para Men") return PARA_MEN;
  if (division === "Para Women") return PARA_WOMEN;
  if (profile === "IAFF-2024") {
    return division === "Men" ? IAFF_MEN : IAFF_WOMEN;
  }
  return division === "Men" ? WAF_MEN : WAF_WOMEN;
}

/**
 * Resolve a measured weight to its bucket.
 * If the athlete is over the lowest bucket they enter, they belong in the
 * lowest bucket whose upperKg is >= measured. Above all buckets ⇒ "+top".
 */
export function bucketForWeight(
  profile: RuleProfileCode,
  division: Division,
  weightKg: number
): WeightBucket {
  const list = bucketsFor(profile, division);
  for (const b of list) {
    if (b.upperKg === null) return b;
    if (weightKg <= b.upperKg) return b;
  }
  return list[list.length - 1]!;
}

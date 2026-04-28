import { bucketForWeight, type Division, type RuleProfileCode } from "./weight-classes";

/**
 * A row that the resolver expects from the registrations table.
 * Only fields needed for category derivation are listed.
 */
export type RegistrationLite = {
  id: string;
  division: Division;
  declared_weight_kg: number;
  age_categories: string[] | null;
  youth_hand: "R" | "L" | "B" | null;
  senior_hand: "R" | "L" | "B" | null;
  is_para: boolean | null;
  para_class: string | null;
};

export type WeighInLite = { measured_kg: number };

export type ResolvedEntry = {
  registration_id: string;
  division: Division;
  age_band: string;        // "Youth" | "Senior" | "Junior" | "Master" etc.
  weight_class: string;    // bucket code
  hand: "R" | "L";
  category_code: string;
};

/**
 * Categories we generate brackets for in week 1. Para → single-arm category.
 * Able-bodied → up to 4 entries (Youth R/L + Senior R/L) according to the
 * athlete's `youth_hand` / `senior_hand` and which age categories they ticked.
 */
export function resolveEntries(
  reg: RegistrationLite,
  weighIn: WeighInLite | null,
  profile: RuleProfileCode = "IAFF-2024"
): ResolvedEntry[] {
  const weightKg = weighIn?.measured_kg ?? reg.declared_weight_kg;
  const bucket = bucketForWeight(profile, reg.division, weightKg);

  // Para: single arm (use senior_hand as preferred; fall back to R).
  if (reg.is_para) {
    const hand = pickFirst(reg.senior_hand) ?? pickFirst(reg.youth_hand) ?? "R";
    const band = (reg.para_class || "Para").toUpperCase();
    return [
      {
        registration_id: reg.id,
        division: reg.division,
        age_band: band,
        weight_class: bucket.code,
        hand,
        category_code: cat(reg.division, band, bucket.code, hand),
      },
    ];
  }

  const out: ResolvedEntry[] = [];
  const ageBands = reg.age_categories ?? [];
  const youthBands = new Set(["SubJunior", "Junior", "Youth"]);
  const seniorBands = new Set(["Senior", "Master", "GrandMaster", "SeniorGrandMaster", "SuperSeniorGrandMaster"]);

  for (const band of ageBands) {
    const isYouth = youthBands.has(band);
    const isSenior = seniorBands.has(band);
    const handField = isYouth ? reg.youth_hand : isSenior ? reg.senior_hand : reg.senior_hand;
    const hands = expandHand(handField);
    for (const h of hands) {
      out.push({
        registration_id: reg.id,
        division: reg.division,
        age_band: band,
        weight_class: bucket.code,
        hand: h,
        category_code: cat(reg.division, band, bucket.code, h),
      });
    }
  }
  return out;
}

function pickFirst(h: "R" | "L" | "B" | null): "R" | "L" | null {
  if (!h) return null;
  if (h === "B") return "R";
  return h;
}

function expandHand(h: "R" | "L" | "B" | null): ("R" | "L")[] {
  if (!h) return ["R"];
  if (h === "B") return ["R", "L"];
  return [h];
}

function cat(div: Division, band: string, weight: string, hand: "R" | "L"): string {
  return `${div}|${band}|${weight}|${hand}`;
}

/**
 * Resolver: (registration v2 + latest weigh-in) -> zero or more `Entry` rows.
 *
 * One registration can fan out across both non-para and para tracks. For
 * non-para, hand "B" expands to two entries (R + L). Para is single-arm,
 * so "B" picks R deterministically.
 */

import {
  WAF_ABLE,
  WAF_PARA,
  wafBucketForWeight,
  type Gender,
} from "./waf-2025";

export type Hand = "R" | "L" | "B";

export type RegistrationLite = {
  id: string;
  gender: Gender;
  declared_weight_kg: number;
  nonpara_classes: string[] | null;
  /** Hands aligned 1-to-1 with nonpara_classes (same length / index). */
  nonpara_hands: (Hand | null)[] | null;
  para_codes: string[] | null;
  para_hand: Hand | null;
};

export type WeighInLite = { measured_kg: number };

export interface ResolvedEntry {
  registration_id: string;
  division: "Men" | "Women" | "Para Men" | "Para Women";
  age_band: string;
  weight_class: string;
  hand: "R" | "L";
  category_code: string;
}

export function resolveEntries(
  reg: RegistrationLite,
  weighIn: WeighInLite | null,
  _refYear: number = new Date().getUTCFullYear()
): ResolvedEntry[] {
  const weightKg = weighIn?.measured_kg ?? reg.declared_weight_kg;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return [];

  const out: ResolvedEntry[] = [];

  for (const className of reg.nonpara_classes ?? []) {
    const cat = WAF_ABLE.find(
      (c) => c.className === className && c.gender === reg.gender
    );
    if (!cat) continue;
    const bucket = wafBucketForWeight(cat, weightKg);
    if (!bucket) continue;
    const idx = (reg.nonpara_classes ?? []).indexOf(className);
    const handForClass = reg.nonpara_hands?.[idx] ?? null;
    const hands = expandHand(handForClass);
    for (const hand of hands) {
      out.push({
        registration_id: reg.id,
        division: reg.gender === "F" ? "Women" : "Men",
        age_band: cat.className,
        weight_class: bucket.label,
        hand,
        category_code: cat.code + "-" + bucket.label + "-" + hand,
      });
    }
  }

  for (const code of reg.para_codes ?? []) {
    const cat = WAF_PARA.find((c) => c.code === code);
    if (!cat) continue;
    const bucket = wafBucketForWeight(cat, weightKg);
    if (!bucket) continue;
    const hand: "R" | "L" = reg.para_hand === "L" ? "L" : "R";
    out.push({
      registration_id: reg.id,
      division: reg.gender === "F" ? "Para Women" : "Para Men",
      age_band: cat.code,
      weight_class: bucket.label,
      hand,
      category_code: cat.code + "-" + bucket.label + "-" + hand,
    });
  }

  return out;
}

function expandHand(h: Hand | null): ("R" | "L")[] {
  if (h === "R") return ["R"];
  if (h === "L") return ["L"];
  if (h === "B") return ["R", "L"];
  return [];
}
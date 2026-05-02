/**
 * Resolver: (registration v2 + latest weigh-in) -> zero or more `Entry` rows.
 *
 * One registration can fan out across both non-para and para tracks.
 * Hand "B" expands to two entries (R + L) for both non-para and para —
 * an athlete who registers Both Hands competes in both arm brackets.
 *
 * Operator weight overrides (`weight_overrides`) let an athlete compete in
 * a heavier bucket than auto. Overrides are keyed by (scope, WAF code,
 * hand) so each emitted entry can be independently bumped. A pick that
 * is lighter than the auto bucket is silently ignored — we never
 * "compete down".
 */

import {
  WAF_ABLE,
  WAF_PARA,
  wafBucketForWeight,
  type Gender,
  type WafBucket,
  type WafCategory,
} from "./waf-2025";

export type Hand = "R" | "L" | "B";

export type WeightOverride = {
  scope: "nonpara" | "para";
  /** WAF category code, e.g. "M", "Y", "U". */
  code: string;
  hand: "R" | "L";
  /** WAF bucket code (e.g. "M-100", "M-110+") OR the sentinel "+1" for
   *  the legacy weight_bump_up backfill which means "next bucket up". */
  bucket_code: string;
};

export type RegistrationLite = {
  id: string;
  gender: Gender;
  declared_weight_kg: number;
  nonpara_classes: string[] | null;
  /** Hands aligned 1-to-1 with nonpara_classes (same length / index). */
  nonpara_hands: (Hand | null)[] | null;
  para_codes: string[] | null;
  para_hand: Hand | null;
  weight_overrides?: WeightOverride[] | null;
};

export type WeighInLite = { measured_kg: number };

export interface ResolvedEntry {
  registration_id: string;
  division: "Men" | "Women" | "Para Men" | "Para Women";
  age_band: string;
  weight_class: string;
  hand: "R" | "L";
  category_code: string;
  /** True when the operator picked a heavier bucket than the auto one. */
  competing_up: boolean;
}

export function resolveEntries(
  reg: RegistrationLite,
  weighIn: WeighInLite | null,
  _refYear: number = new Date().getUTCFullYear()
): ResolvedEntry[] {
  const weightKg = weighIn?.measured_kg ?? reg.declared_weight_kg;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return [];

  const overrides = reg.weight_overrides ?? [];
  const out: ResolvedEntry[] = [];

  for (const className of reg.nonpara_classes ?? []) {
    const cat = WAF_ABLE.find(
      (c) => c.className === className && c.gender === reg.gender
    );
    if (!cat) continue;
    const auto = wafBucketForWeight(cat, weightKg);
    const idx = (reg.nonpara_classes ?? []).indexOf(className);
    const handForClass = reg.nonpara_hands?.[idx] ?? null;
    for (const hand of expandHand(handForClass)) {
      const picked = pickBucket(cat, auto, overrides, "nonpara", hand);
      out.push(makeEntry(reg, cat, picked.bucket, hand, picked.competingUp));
    }
  }

  for (const code of reg.para_codes ?? []) {
    const cat = WAF_PARA.find((c) => c.code === code);
    if (!cat) continue;
    const auto = wafBucketForWeight(cat, weightKg);
    for (const hand of expandHand(reg.para_hand)) {
      const picked = pickBucket(cat, auto, overrides, "para", hand);
      out.push(makeEntry(reg, cat, picked.bucket, hand, picked.competingUp));
    }
  }

  return out;
}

function makeEntry(
  reg: RegistrationLite,
  cat: WafCategory,
  bucket: WafBucket,
  hand: "R" | "L",
  competingUp: boolean
): ResolvedEntry {
  const division: ResolvedEntry["division"] = cat.isPara
    ? reg.gender === "F"
      ? "Para Women"
      : "Para Men"
    : reg.gender === "F"
    ? "Women"
    : "Men";
  return {
    registration_id: reg.id,
    division,
    age_band: cat.isPara ? cat.code : cat.className,
    weight_class: bucket.label,
    hand,
    category_code: cat.code + "-" + bucket.label + "-" + hand,
    competing_up: competingUp,
  };
}

function expandHand(h: Hand | null): ("R" | "L")[] {
  if (h === "R") return ["R"];
  if (h === "L") return ["L"];
  if (h === "B") return ["R", "L"];
  return [];
}

/**
 * Apply an override if one matches (scope,code,hand) AND points to a
 * heavier bucket than `auto`. The "+1" sentinel (legacy backfill) is
 * translated into the next-bucket-up. Anything else is ignored.
 */
function pickBucket(
  cat: WafCategory,
  auto: WafBucket,
  overrides: WeightOverride[],
  scope: "nonpara" | "para",
  hand: "R" | "L"
): { bucket: WafBucket; competingUp: boolean } {
  const ov = overrides.find(
    (o) => o.scope === scope && o.code === cat.code && o.hand === hand
  );
  if (!ov) return { bucket: auto, competingUp: false };

  let target: WafBucket | undefined;
  if (ov.bucket_code === "+1") {
    const i = cat.buckets.findIndex((b) => b.code === auto.code);
    target = i >= 0 ? cat.buckets[i + 1] : undefined;
  } else {
    target = cat.buckets.find((b) => b.code === ov.bucket_code);
  }

  if (!target) return { bucket: auto, competingUp: false };
  if (!isHeavier(target, auto)) return { bucket: auto, competingUp: false };
  return { bucket: target, competingUp: true };
}

function isHeavier(a: WafBucket, b: WafBucket): boolean {
  if (a.code === b.code) return false;
  if (a.upperKg === null && b.upperKg === null) return false;
  if (a.upperKg === null) return true; // open is heavier than any bounded
  if (b.upperKg === null) return false;
  return a.upperKg > b.upperKg;
}

/**
 * Buckets the operator may pick for this (cat, current weight): the auto
 * bucket plus every heavier bucket. Used by the weigh-in / counter-desk
 * dropdowns. The auto bucket is always the first element.
 */
export function allowedHeavierBuckets(
  cat: WafCategory,
  weightKg: number
): WafBucket[] {
  const auto = wafBucketForWeight(cat, weightKg);
  const i = cat.buckets.findIndex((b) => b.code === auto.code);
  if (i < 0) return [auto];
  return cat.buckets.slice(i);
}

/** Whitelist + coerce a wire-side overrides array. Bad shapes dropped. */
export function sanitizeOverrides(raw: unknown): WeightOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: WeightOverride[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (o.scope !== "nonpara" && o.scope !== "para") continue;
    if (typeof o.code !== "string" || !o.code) continue;
    if (o.hand !== "R" && o.hand !== "L") continue;
    if (typeof o.bucket_code !== "string" || !o.bucket_code) continue;
    out.push({
      scope: o.scope,
      code: o.code,
      hand: o.hand,
      bucket_code: o.bucket_code,
    });
  }
  return out;
}

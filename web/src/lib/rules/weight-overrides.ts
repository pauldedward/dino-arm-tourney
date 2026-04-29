/**
 * UI helpers around `weight_overrides`. One row per resolved entry
 * (scope × WAF code × hand). Drives the weigh-in / counter-desk picker
 * and the per-entry "competing up" badge in tables and sheets.
 */

import {
  WAF_ABLE,
  WAF_PARA,
  wafBucketForWeight,
  type WafBucket,
  type WafCategory,
} from "./waf-2025";
import {
  type WeightOverride,
  allowedHeavierBuckets,
} from "./resolve";

export type OverrideRow = {
  scope: "nonpara" | "para";
  /** WAF category code (e.g. "M", "Y", "U"). Stable identity for the override. */
  code: string;
  /** Display name for the class column (e.g. "SENIOR", "PIU Standing"). */
  className: string;
  hand: "R" | "L";
  /** Bucket the auto rules placed this entry in. */
  autoBucket: WafBucket;
  /** Bucket the override (if any) currently points to. Equals `autoBucket` when no override. */
  selectedBucket: WafBucket;
  /** Auto bucket + every heavier bucket in this category. */
  allowedBuckets: WafBucket[];
  /** True when `selectedBucket` is heavier than `autoBucket`. */
  competingUp: boolean;
};

/**
 * Compute one OverrideRow per resolved entry on this registration at
 * the given weight. `B` hand on non-para fans into R + L. Returns [] if
 * the weight is invalid or the registration has no classes.
 */
export function buildOverrideRows(
  reg: {
    gender: "M" | "F" | null;
    nonpara_classes: string[] | null;
    nonpara_hands: Array<"R" | "L" | "B" | null> | null;
    para_codes: string[] | null;
    para_hand: "R" | "L" | "B" | null;
    weight_overrides?: WeightOverride[] | null | undefined;
  },
  weightKg: number
): OverrideRow[] {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return [];
  const overrides = reg.weight_overrides ?? [];
  const rows: OverrideRow[] = [];

  const npClasses = reg.nonpara_classes ?? [];
  const npHands = reg.nonpara_hands ?? [];
  for (let i = 0; i < npClasses.length; i++) {
    const cat = WAF_ABLE.find(
      (c) => c.className === npClasses[i] && c.gender === reg.gender
    );
    if (!cat) continue;
    const handRaw = npHands[i] ?? null;
    const hands = handRaw === "B" ? (["R", "L"] as const) : handRaw ? [handRaw] as ("R"|"L")[] : [];
    for (const hand of hands) {
      rows.push(buildRow(cat, "nonpara", hand, weightKg, overrides));
    }
  }

  for (const code of reg.para_codes ?? []) {
    const cat = WAF_PARA.find((c) => c.code === code);
    if (!cat) continue;
    const hand: "R" | "L" = reg.para_hand === "L" ? "L" : "R";
    rows.push(buildRow(cat, "para", hand, weightKg, overrides));
  }
  return rows;
}

function buildRow(
  cat: WafCategory,
  scope: "nonpara" | "para",
  hand: "R" | "L",
  weightKg: number,
  overrides: WeightOverride[]
): OverrideRow {
  const auto = wafBucketForWeight(cat, weightKg);
  const allowed = allowedHeavierBuckets(cat, weightKg);
  const ov = overrides.find(
    (o) => o.scope === scope && o.code === cat.code && o.hand === hand
  );
  let selected = auto;
  if (ov) {
    let target: WafBucket | undefined;
    if (ov.bucket_code === "+1") {
      const i = cat.buckets.findIndex((b) => b.code === auto.code);
      target = i >= 0 ? cat.buckets[i + 1] : undefined;
    } else {
      target = cat.buckets.find((b) => b.code === ov.bucket_code);
    }
    if (target && allowed.some((b) => b.code === target!.code)) {
      selected = target;
    }
  }
  return {
    scope,
    code: cat.code,
    className: scope === "para" ? cat.code : cat.className,
    hand,
    autoBucket: auto,
    selectedBucket: selected,
    allowedBuckets: allowed,
    competingUp: selected.code !== auto.code,
  };
}

/**
 * Update an overrides array: pick `newBucketCode` for (scope, code, hand).
 * If the new pick equals the auto bucket, remove the override entirely.
 * Other entries' overrides are preserved.
 */
export function setOverride(
  current: WeightOverride[] | null | undefined,
  row: OverrideRow,
  newBucketCode: string
): WeightOverride[] {
  const out = (current ?? []).filter(
    (o) => !(o.scope === row.scope && o.code === row.code && o.hand === row.hand)
  );
  if (newBucketCode !== row.autoBucket.code) {
    out.push({
      scope: row.scope,
      code: row.code,
      hand: row.hand,
      bucket_code: newBucketCode,
    });
  }
  return out;
}

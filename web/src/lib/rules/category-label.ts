/**
 * Human-readable labels for WAF category codes.
 *
 * Category codes from `resolveEntries` look like `<CLASS>-<WEIGHT>-<HAND>`,
 * e.g. `M-−80 kg-R` or `GVW-OPEN-L`. They are short enough to fit in
 * tables but unreadable to anyone who hasn't memorised the WAF chart.
 *
 * `formatCategoryCode` returns a long form like
 *   "Senior Men · −80 kg · Right"
 * suitable for headers and dropdowns. The original code is still kept
 * as the canonical key (URL filter value, fixture rows, PDF code chip).
 *
 * Note: weight bucket labels use a Unicode minus sign (U+2212), not a
 * hyphen-minus, so splitting the code on `-` is safe.
 */

const CLASS_LABELS: Record<string, string> = {
  // Able-bodied
  K: "Sub-Junior 15 Men",
  KW: "Sub-Junior 15 Women",
  J: "Junior 18 Men",
  JW: "Junior 18 Women",
  Y: "Youth 23 Men",
  YW: "Youth 23 Women",
  M: "Senior Men",
  F: "Senior Women",
  V: "Master Men",
  VW: "Master Women",
  GV: "Grand Master Men",
  GVW: "Grand Master Women",
  SGV: "Sr Grand Master Men",
  SPV: "Super Sr Grand Master Men",
  // Para
  D: "Para PID Sit Men",
  DW: "Para PID Sit Women",
  DA: "Para PIDH Sit Men",
  U: "Para PIU Stand Men",
  UW: "Para PIU Stand Women",
  UJ: "Para PIU Jr Men",
  UJW: "Para PIU Jr Women",
  UA: "Para PIUH Stand Men",
  UWA: "Para PIUH Stand Women",
  UJA: "Para PIUH Jr Men",
  E: "Para VI Stand Men",
  EW: "Para VI Stand Women",
  EJ: "Para VI Jr Men",
  EJW: "Para VI Jr Women",
  H: "Para HI Stand Men",
  HW: "Para HI Stand Women",
  HJ: "Para HI Jr Men",
  HJW: "Para HI Jr Women",
  DC: "Para CPD Sit Men",
  UC: "Para CPU Stand Men",
};

const HAND_LABELS: Record<string, string> = {
  R: "Right",
  L: "Left",
};

export type CategoryParts = {
  classCode: string;
  classLabel: string;
  weight: string;
  hand: string;
  handLabel: string;
};

export function parseCategoryCode(code: string): CategoryParts | null {
  const parts = code.split("-");
  if (parts.length < 3) return null;
  const classCode = parts[0];
  const hand = parts[parts.length - 1];
  const weight = parts.slice(1, -1).join("-");
  if (!classCode || !weight || !hand) return null;
  return {
    classCode,
    classLabel: CLASS_LABELS[classCode] ?? classCode,
    weight,
    hand,
    handLabel: HAND_LABELS[hand] ?? hand,
  };
}

export function formatCategoryCode(code: string): string {
  const p = parseCategoryCode(code);
  if (!p) return code;
  return `${p.classLabel} · ${p.weight} · ${p.handLabel}`;
}

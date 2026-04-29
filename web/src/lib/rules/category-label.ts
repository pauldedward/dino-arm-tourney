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
import { WAF_ALL, wafCategory } from "./waf-2025";

const NONPARA_CLASS_FULL_BY_NAME: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of WAF_ALL) {
    // Several gendered rows share the same className/classFull (e.g.
    // M + F → "SENIOR" → "Senior"). first-write-wins is fine.
    if (!m.has(c.className.toUpperCase())) {
      m.set(c.className.toUpperCase(), c.classFull);
    }
  }
  return m;
})();

// Note: per product direction the age number embedded in non-para class
// names ("Sub-Junior 15", "Junior 18", "Youth 23") is intentionally
// omitted in user-facing labels. The numeric age band is still encoded
// in the canonical code (K/KW/J/JW/Y/YW/...), which we keep as the
// machine-readable key for filters, fixtures, exports etc.
const CLASS_LABELS: Record<string, string> = {
  // Able-bodied
  K: "Sub-Junior Men",
  KW: "Sub-Junior Women",
  J: "Junior Men",
  JW: "Junior Women",
  Y: "Youth Men",
  YW: "Youth Women",
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

/**
 * Strip the trailing age number that the WAF roster uses to disambiguate
 * the youth bands ("Sub-Junior 15", "Junior 18", "Youth 23"). Returns
 * the visible class WITHOUT the number — e.g. "Junior 18" → "Junior",
 * "JUNIOR 18" → "Junior", "Senior" stays "Senior".
 *
 * Used everywhere we render a non-para class to a human (registration
 * dropdowns, counter desk pickers, nominal sheet, category sheet).
 * The original numeric-suffixed string is still the canonical key in
 * `registrations.nonpara_classes`, so functionality is unaffected.
 */
export function prettyNonparaClassName(value: string | null | undefined): string {
  if (!value) return "";
  // Title-case lookup against the WAF list ("JUNIOR 18" → "Junior 18"),
  // then drop a trailing " <digits>" if present.
  const titled = NONPARA_CLASS_FULL_BY_NAME.get(value.trim().toUpperCase()) ?? value.trim();
  return titled.replace(/\s+\d+\s*$/u, "").trim();
}

/**
 * Resolve a para WAF code (e.g. "U", "EW", "PD1") to its readable class
 * label using the same `CLASS_LABELS` table that powers
 * `formatCategoryCode`. Falls back to the `wafCategory().classFull`
 * (e.g. "PIU Standing") and finally to the raw code so we never drop
 * data on the floor.
 */
export function prettyParaCode(code: string | null | undefined): string {
  if (!code) return "";
  const trimmed = code.trim();
  if (!trimmed) return trimmed;
  const upper = trimmed.toUpperCase();
  const fromTable = CLASS_LABELS[upper];
  if (fromTable) return fromTable;
  const cat = wafCategory(upper);
  return cat?.classFull ?? trimmed;
}

/**
 * Join the displayable categories on a Nominal Roll row. Input is the
 * mixed array we historically stored as `age_categories` (uppercase
 * non-para class names) followed by `para_codes` (WAF codes). Each
 * value is mapped to its readable label and de-duplicated.
 *
 * Heuristic: anything matching a known WAF code letter is treated as
 * para (the codes never collide with the SCREAMING-SNAKE class names
 * — class names contain spaces or hyphens, codes don't). This lets one
 * helper handle both lists without forcing every caller to track
 * provenance.
 */
export function formatCategoryListForDisplay(
  values: ReadonlyArray<string | null | undefined>,
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (!raw) continue;
    const v = raw.trim();
    if (!v) continue;
    const upper = v.toUpperCase();
    // Pure-uppercase no-space token → treat as a WAF para code.
    const looksLikeCode =
      /^[A-Z]+\d*$/.test(upper) && (CLASS_LABELS[upper] || wafCategory(upper));
    const label = looksLikeCode ? prettyParaCode(v) : prettyNonparaClassName(v);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.join(", ");
}

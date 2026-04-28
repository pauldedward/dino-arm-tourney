/**
 * Compact, *consistent* class labels for the printed ID card.
 *
 * The rest of the app already has canonical names for every WAF class
 * (see `category-label.ts` and `waf-2025.ts`). We reuse those instead
 * of inventing a parallel set of abbreviations like "SR"/"JR18", so the
 * card matches the category sheet, fixtures sheet and admin filters.
 *
 *  - Non-para input is the className stored in
 *    `registrations.nonpara_classes`, e.g. `"SENIOR"`, `"JUNIOR 18"`.
 *    We render `WafCategory.classFull` for it: `"Senior"`, `"Junior 18"`.
 *
 *  - Para input is a WAF code from `registrations.para_codes`, e.g.
 *    `"U"`, `"EW"`. We render the (already short) `className`:
 *    `"PIU Standing"`, `"VI Visual Standing"`.
 */
import { WAF_ALL, wafCategory } from "./waf-2025";

const CLASS_FULL_BY_NAME: Map<string, string> = (() => {
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

/** Resolve a single non-para class label to its canonical short form. */
export function nonparaClassLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toUpperCase();
  if (!key) return null;
  return CLASS_FULL_BY_NAME.get(key) ?? value.trim();
}

/** Resolve a single para code to its canonical short form. */
export function paraCodeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  const cat = wafCategory(trimmed.toUpperCase());
  return cat?.className ?? trimmed;
}

/**
 * Combine the athlete's non-para classes + para codes into a single
 * compact string for the ID card. De-duplicates labels (e.g. an athlete
 * entered into both M and F SENIOR via two registrations would still
 * show "Senior" once) and drops blanks. Returns null when nothing
 * usable is left.
 */
export function classLabelsForCard(input: {
  nonparaClasses?: readonly (string | null | undefined)[] | null;
  paraCodes?: readonly (string | null | undefined)[] | null;
}): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const v of input.nonparaClasses ?? []) {
    const label = nonparaClassLabel(v);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    parts.push(label);
  }
  for (const v of input.paraCodes ?? []) {
    const label = paraCodeLabel(v);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    parts.push(label);
  }

  return parts.length === 0 ? null : parts.join(", ");
}

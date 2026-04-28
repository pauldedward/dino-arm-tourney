/**
 * Pure aggregation helper for the Category Sheet (PDF + preview).
 *
 * Groups eligible registrations into WAF category buckets via
 * `resolveEntries`. This is independent of the `entries` table so the
 * sheet works at any point in the event lifecycle — including before
 * fixtures are generated and for categories that have only a single
 * athlete (which never produce fixture rows).
 */

import { resolveEntries, type RegistrationLite, type WeighInLite } from "@/lib/rules/resolve";

export type CategoryGroupReg = RegistrationLite & {
  chest_no: number | null;
  full_name: string | null;
  district: string | null;
};

export type CategoryAthlete = {
  chest_no: number | null;
  full_name: string | null;
  district: string | null;
};

export type CategoryGroup = {
  category_code: string;
  athletes: CategoryAthlete[];
};

export function groupRegistrationsByCategory(
  regs: CategoryGroupReg[],
  weighInsByReg: Map<string, WeighInLite>,
  refYear: number = new Date().getUTCFullYear()
): CategoryGroup[] {
  const grouped = new Map<string, CategoryAthlete[]>();
  for (const r of regs) {
    const resolved = resolveEntries(r, weighInsByReg.get(r.id) ?? null, refYear);
    // Dedupe within a single registration: hand=B fans out to two entries
    // but for the category sheet we want one row per (registration,
    // category_code) pair, which is already the case since R/L produce
    // different category codes.
    for (const e of resolved) {
      if (!grouped.has(e.category_code)) grouped.set(e.category_code, []);
      grouped.get(e.category_code)!.push({
        chest_no: r.chest_no,
        full_name: r.full_name,
        district: r.district,
      });
    }
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category_code, athletes]) => ({
      category_code,
      athletes: athletes
        .slice()
        .sort(
          (a, b) =>
            (a.chest_no ?? 1e9) - (b.chest_no ?? 1e9) ||
            (a.full_name ?? "").localeCompare(b.full_name ?? "")
        ),
    }));
}

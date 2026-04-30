import {
  prettyNonparaClassName,
  prettyParaCode,
} from "@/lib/rules/category-label";
import type { WeightOverride } from "@/lib/rules/resolve";
import { buildOverrideRows } from "@/lib/rules/weight-overrides";

/**
 * Minimum row shape needed to render a list of resolved competition
 * categories (gender · age class · hand · resolved weight bucket).
 * Both the registrations grid and the weigh-in queue use this so the
 * floor staff sees identical labels in both surfaces.
 */
export type ClassesCellRow = {
  declared_weight_kg: number | null;
  weight_class_code?: string | null;
  gender?: string | null;
  nonpara_classes?: string[] | null;
  nonpara_hands?: Array<string | null> | null;
  nonpara_hand?: string | null;
  para_codes?: string[] | null;
  para_hand?: string | null;
  weight_overrides?: WeightOverride[] | null;
};

export function handLabel(h: string | null | undefined): string {
  if (!h) return "";
  if (h === "B") return "R+L";
  if (h === "R") return "Right";
  if (h === "L") return "Left";
  return h;
}

export function genderLabel(g: string | null | undefined): string {
  if (g === "M") return "Men";
  if (g === "F") return "Women";
  return "";
}

export default function ClassesCell({ row }: { row: ClassesCellRow }) {
  const nonparaClasses = row.nonpara_classes ?? [];
  const nonparaHands = row.nonpara_hands ?? [];
  const fallbackHand = row.nonpara_hand ?? null;
  const paraCodes = row.para_codes ?? [];
  const paraHand = row.para_hand ?? null;
  const gender = genderLabel(row.gender);

  const wt = Number(row.declared_weight_kg);
  const resolved =
    Number.isFinite(wt) && wt > 0
      ? buildOverrideRows(
          {
            gender: row.gender as "M" | "F" | null,
            nonpara_classes: nonparaClasses,
            nonpara_hands: (nonparaHands.length > 0
              ? nonparaHands
              : nonparaClasses.map(() => fallbackHand)) as Array<
              "R" | "L" | "B" | null
            >,
            para_codes: paraCodes,
            para_hand: paraHand as "R" | "L" | "B" | null,
            weight_overrides: row.weight_overrides ?? [],
          },
          wt
        )
      : [];
  const bucketByKey = new Map<string, { label: string; up: boolean }>();
  for (const r of resolved) {
    const key = `${r.scope}|${r.code}`;
    if (!bucketByKey.has(key)) {
      bucketByKey.set(key, {
        label: r.selectedBucket.label,
        up: r.competingUp,
      });
    }
  }

  type Item = {
    para: boolean;
    gender: string;
    age: string;
    hand: string;
    bucket?: { label: string; up: boolean };
  };
  const items: Item[] = [];
  nonparaClasses.forEach((cls, i) => {
    const r = resolved.find(
      (x) => x.scope === "nonpara" && x.className === cls
    );
    items.push({
      para: false,
      gender,
      age: prettyNonparaClassName(cls) || cls,
      hand: handLabel(nonparaHands[i] ?? fallbackHand),
      bucket: r ? { label: r.selectedBucket.label, up: r.competingUp } : undefined,
    });
  });
  paraCodes.forEach((code) => {
    const b = bucketByKey.get(`para|${code}`);
    items.push({
      para: true,
      gender,
      age: prettyParaCode(code) || code,
      hand: handLabel(paraHand),
      bucket: b,
    });
  });

  if (items.length === 0) {
    return (
      <span className="font-mono text-[12px] text-ink/40">
        {row.weight_class_code ?? "—"}
      </span>
    );
  }

  return (
    <ul className="flex flex-col gap-1 text-[13px] leading-tight">
      {items.map((it, i) => {
        const meta = [it.gender, it.hand].filter(Boolean).join(" · ");
        return (
          <li
            key={`${it.age}-${i}`}
            className="group flex items-center justify-between gap-3 border-l-2 border-ink/15 pl-2 hover:border-ink/40"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold text-ink">{it.age}</span>
              {meta && (
                <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink/45">
                  {meta}
                </span>
              )}
            </span>
            {it.bucket && (
              <span
                className={`shrink-0 whitespace-nowrap rounded-sm border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                  it.bucket.up
                    ? "border-rust bg-rust/10 font-bold text-rust"
                    : "border-ink/20 bg-bone text-ink/70"
                }`}
                title={
                  it.bucket.up
                    ? "Operator picked a heavier bucket"
                    : "Auto bucket from weight"
                }
              >
                {it.bucket.label}
                {it.bucket.up ? " ↑" : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

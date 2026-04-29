"use client";

import { buildOverrideRows, setOverride } from "@/lib/rules/weight-overrides";
import type { WeightOverride } from "@/lib/rules/resolve";

/**
 * Per-resolved-entry weight class picker.
 *
 * Shows one row per (scope × WAF code × hand). Dropdown lists the auto
 * bucket plus every heavier bucket. Picking a heavier bucket adds a
 * `competing up` chip; reverting to the auto bucket removes the override.
 */
export default function WeightOverridePicker({
  reg,
  weightKg,
  value,
  onChange,
  compact = false,
}: {
  reg: Parameters<typeof buildOverrideRows>[0];
  weightKg: number;
  value: WeightOverride[] | null | undefined;
  onChange: (next: WeightOverride[]) => void;
  compact?: boolean;
}) {
  const rows = buildOverrideRows({ ...reg, weight_overrides: value }, weightKg);
  if (rows.length === 0) {
    return (
      <p className="font-mono text-[11px] text-ink/50">
        No weight categories — choose a class first or enter a valid weight.
      </p>
    );
  }
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {rows.map((row) => {
        const key = `${row.scope}-${row.code}-${row.hand}`;
        return (
          <div
            key={key}
            className="flex items-center gap-3 border border-ink/15 bg-paper px-2 py-1"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60 w-32 truncate">
              {row.className} · {row.hand}
            </span>
            <select
              value={row.selectedBucket.code}
              onChange={(e) => onChange(setOverride(value, row, e.target.value))}
              className="border border-ink/30 bg-paper px-2 py-0.5 font-mono text-xs"
            >
              {row.allowedBuckets.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.label}
                  {b.code === row.autoBucket.code ? " (auto)" : ""}
                </option>
              ))}
            </select>
            {row.competingUp && (
              <span className="border border-rust/60 bg-rust/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.25em] text-rust">
                competing up
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

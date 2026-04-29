import PendingLink from "@/components/PendingLink";

export type DistrictTotal = {
  district: string;
  athletes_n: number;
  collected_inr: number;
  pending_inr: number;
  collected_n: number;
  pending_n: number;
};

/**
 * Per-district money + headcount card. Powers the "By district" view: at a
 * glance the operator sees who has paid, who hasn't, and clicks through to
 * the registrations page filtered + grouped to that district to take action.
 *
 * The bar visualises collected vs total, so a half-empty district stands
 * out without reading numbers.
 */
export function DistrictSummary({
  eventSlug,
  totals,
}: {
  eventSlug: string;
  totals: DistrictTotal[];
}) {
  const grandPending = totals.reduce((s, t) => s + t.pending_inr, 0);
  const grandCollected = totals.reduce((s, t) => s + t.collected_inr, 0);
  return (
    <section className="border-2 border-ink bg-bone">
      <div className="flex items-center justify-between border-b-2 border-ink/10 bg-kraft/20 px-5 py-3">
        <div>
          <h2 className="font-display text-xl font-black tracking-tight">
            By district
          </h2>
          <p className="mt-0.5 font-mono text-[12px] uppercase tracking-[0.2em] text-ink/60">
            ₹{grandCollected.toLocaleString("en-IN")} collected ·{" "}
            <span className={grandPending > 0 ? "text-rust" : ""}>
              ₹{grandPending.toLocaleString("en-IN")} pending
            </span>
          </p>
        </div>
        <PendingLink
          href={`/admin/events/${eventSlug}/registrations?group=district`}
          prefetch
          className="border-2 border-ink px-3 py-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.2em] hover:bg-kraft/40"
        >
          Open grouped view →
        </PendingLink>
      </div>
      <ul className="divide-y divide-ink/10">
        {totals.map((t) => {
          const total = t.collected_inr + t.pending_inr;
          const pct = total > 0 ? Math.round((t.collected_inr / total) * 100) : 0;
          const allPaid = t.pending_n === 0 && t.athletes_n > 0;
          const nothingPaid = t.collected_n === 0 && t.athletes_n > 0;
          return (
            <li key={t.district} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3">
              <div>
                <PendingLink
                  href={`/admin/events/${eventSlug}/registrations?district=${encodeURIComponent(t.district)}`}
                  prefetch
                  className="font-display text-base font-bold tracking-tight hover:underline"
                >
                  {t.district}
                </PendingLink>
                <p className="mt-0.5 font-mono text-[12px] uppercase tracking-[0.2em] text-ink/50">
                  {t.athletes_n} athlete{t.athletes_n === 1 ? "" : "s"}
                </p>
              </div>
              <div className="w-40">
                {/* When nothing has been paid, the bar would be empty;
                    we paint the empty container in faint rust so a row
                    of zero-collection districts is visually scannable. */}
                <div
                  className={`h-3 border-2 border-ink ${nothingPaid ? "bg-rust/15" : "bg-bone"}`}
                >
                  <div
                    className={`h-full ${allPaid ? "bg-moss" : "bg-ink"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-right font-mono text-[12px] tabular-nums text-ink/60">
                  {t.collected_n}/{t.athletes_n} paid
                </p>
              </div>
              <div className="w-32 text-right">
                <p className="font-mono text-[13px] tabular-nums text-moss">
                  ₹{t.collected_inr.toLocaleString("en-IN")}
                </p>
                {t.pending_inr > 0 && (
                  <p className="font-mono text-[13px] tabular-nums text-rust">
                    ₹{t.pending_inr.toLocaleString("en-IN")} owed
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Small badge that surfaces an event's `payment_mode`
 * (online_upi | offline | hybrid) in lists / cards / dashboards so
 * operators and athletes immediately know whether the event collects
 * money via UPI, at the venue counter, or both.
 *
 * Lives in `components/` (not `components/admin/`) because both public
 * landing cards and admin tables consume it.
 */

export type PaymentMode = "online_upi" | "offline" | "hybrid";

const LABELS: Record<
  PaymentMode,
  { short: string; long: string; cls: string }
> = {
  online_upi: {
    short: "UPI",
    long: "Online · UPI",
    cls: "border-moss text-moss",
  },
  offline: {
    short: "Counter",
    long: "Pay at counter",
    cls: "border-rust text-rust",
  },
  hybrid: {
    short: "UPI / counter",
    long: "UPI or counter",
    cls: "border-ink text-ink",
  },
};

export default function PaymentModeBadge({
  mode,
  variant = "long",
  className = "",
}: {
  mode: PaymentMode | string | null | undefined;
  variant?: "short" | "long";
  className?: string;
}) {
  const m = (mode ?? "online_upi") as PaymentMode;
  const meta = LABELS[m] ?? LABELS.online_upi;
  return (
    <span
      className={`inline-flex items-center gap-2 border-2 bg-bone px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.25em] ${meta.cls} ${className}`}
    >
      <span className="text-ink/40">Pay</span>
      <span>{variant === "short" ? meta.short : meta.long}</span>
    </span>
  );
}

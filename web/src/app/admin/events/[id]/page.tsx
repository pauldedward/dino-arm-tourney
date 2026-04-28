import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/db/supabase-service";
import { requireRole } from "@/lib/auth/roles";
import PublishControls from "./PublishControls";
import LiveRefresh from "@/components/LiveRefresh";
import PendingLink from "@/components/PendingLink";

export const dynamic = "force-dynamic";

type DashboardPayload = {
  event: Record<string, unknown> & {
    id: string;
    slug: string;
    name: string;
    status: string;
    starts_at: string;
    venue_city: string | null;
    primary_color: string | null;
    accent_color: string | null;
    text_on_primary: string | null;
    registration_published_at: string | null;
    registration_closed_at: string | null;
    entry_fee_default_inr: number | null;
    payment_mode: "online_upi" | "offline" | "hybrid" | null;
  };
  counts: { total_regs: number; pending_pays: number; verified_pays: number };
  totals: { collected_inr: number; pending_inr: number; collected_n: number; pending_n: number };
  districts: Array<{
    district: string;
    athletes_n: number;
    collected_inr: number;
    pending_inr: number;
    collected_n: number;
    pending_n: number;
  }>;
};

export default async function EventDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("operator", "/admin/events");
  const { id: idOrSlug } = await params;
  const svc = createServiceClient();

  // 1 RTT: SQL function returns event row + counts + ₹ totals +
  // per-district totals as one JSON payload. Was 4 separate queries.
  const { data } = await svc.rpc("event_dashboard", { p_id_or_slug: idOrSlug });
  if (!data) redirect("/admin/events?gone=event");
  const payload = data as DashboardPayload;
  const event = payload.event;
  const totalRegs = payload.counts.total_regs;
  const pendingPays = payload.counts.pending_pays;
  const verifiedPays = payload.counts.verified_pays;
  const collectedInr = payload.totals.collected_inr;
  const pendingInr = payload.totals.pending_inr;
  const paymentMode = (event.payment_mode ?? "online_upi") as
    | "online_upi"
    | "offline"
    | "hybrid";

  return (
    <div className="space-y-10">
      <LiveRefresh tables={["registrations", "payments", "weigh_ins", "events"]} eventId={event.id} />
      {/* Header with branding bar */}
      <div
        className="border-2 border-ink p-6"
        style={{ background: event.primary_color ?? "#0f3d2e", color: event.text_on_primary ?? "#fff" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] opacity-70">
              Event · {event.status}
            </p>
            <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
              {event.name}
            </h1>
            <p className="mt-2 font-mono text-xs opacity-80">
              {new Date(event.starts_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}
              {event.venue_city && ` · ${event.venue_city}`}
            </p>
          </div>
          <a
            href={`/e/${event.slug}`}
            target="_blank"
            rel="noopener"
            className="border-2 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{ borderColor: event.accent_color ?? "#f5c518", color: event.accent_color ?? "#f5c518" }}
          >
            View public ↗
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ModePill mode={paymentMode} />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/50">
          Entry fee · ₹{event.entry_fee_default_inr ?? 0} / hand
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <Stat
          label="Registrations"
          n={totalRegs ?? 0}
          href={`/admin/events/${event.slug}/registrations`}
          subtitle="View / verify"
        />
        <Stat
          label="₹ Collected"
          n={collectedInr}
          suffix="₹"
          subtitle={`${verifiedPays ?? 0} payment${verifiedPays === 1 ? "" : "s"}`}
        />
        <Stat
          label="₹ Pending"
          n={pendingInr}
          suffix="₹"
          subtitle={`${pendingPays ?? 0} payment${pendingPays === 1 ? "" : "s"}`}
          urgent={pendingInr > 0}
        />
        <CollectedRatioStat
          collectedInr={collectedInr}
          pendingInr={pendingInr}
        />
      </div>

      <PublishControls
        eventId={event.id}
        status={event.status}
        registrationPublishedAt={event.registration_published_at}
        registrationClosedAt={event.registration_closed_at}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <QuickLink
          href={`/admin/events/${event.slug}/counter`}
          title="Counter desk"
          desc="Walk-in registration. Add an athlete, take payment, mark weigh-in — one form."
        />
        <QuickLink
          href={`/admin/events/${event.slug}/registrations`}
          title="Registrations"
          desc="Search every entry, verify payments, view photos & proofs."
        />
        <QuickLink href={`/admin/events/${event.slug}/weighin`} title="Weigh-in" desc="Capture measured weight + live photo." />
        <QuickLink href={`/admin/events/${event.slug}/print`} title="Print & Fixtures" desc="Nominal, category, ID cards. Generate brackets, print fixtures." />
        <QuickLink href={`/admin/events/${event.slug}/edit`} title="Edit event" desc="Branding, payment, poster, circular, operators." />
        <QuickLink href={`/e/${event.slug}/register`} title="Public form" desc="Open the registration form in a new tab." external />
      </div>
    </div>
  );
}

function Stat({
  label,
  n,
  urgent,
  suffix,
  subtitle,
  href,
}: {
  label: string;
  n: number;
  urgent?: boolean;
  suffix?: string;
  subtitle?: string;
  href?: string;
}) {
  const display = n.toLocaleString("en-IN");
  const body = (
    <span className="block w-full">
      <span className="block font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
        {label}
      </span>
      <span
        className={`tnum mt-2 block font-display text-5xl font-black tracking-tight ${urgent ? "text-rust" : ""}`}
      >
        {suffix && <span className="mr-1 text-2xl text-ink/50">{suffix}</span>}
        {display}
      </span>
      {subtitle && (
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
          {subtitle}
        </span>
      )}
    </span>
  );
  const className = `border-2 p-5 ${urgent ? "border-rust bg-rust/5" : "border-ink bg-bone"}`;
  if (href) {
    return (
      <PendingLink
        href={href}
        prefetch
        className={`${className} block transition hover:-translate-y-0.5 hover:bg-kraft/30`}
      >
        {body}
      </PendingLink>
    );
  }
  return <div className={className}>{body}</div>;
}

function ModePill({ mode }: { mode: "online_upi" | "offline" | "hybrid" }) {
  const labels = {
    online_upi: { text: "Online · UPI", color: "border-moss text-moss" },
    offline: { text: "Pay at venue", color: "border-rust text-rust" },
    hybrid: { text: "UPI or counter", color: "border-ink text-ink" },
  } as const;
  const m = labels[mode];
  return (
    <span
      className={`inline-flex items-center gap-2 border-2 bg-bone px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] ${m.color}`}
    >
      <span className="text-ink/40">Mode</span>
      <span>{m.text}</span>
    </span>
  );
}

/**
 * "% collected" tile. Most directly answers the operator question
 * "are we ready to start the event?" — a quick health gauge.
 * Safe when total = 0 (e.g. free events): renders a "—" rather than NaN%.
 */
function CollectedRatioStat({
  collectedInr,
  pendingInr,
}: {
  collectedInr: number;
  pendingInr: number;
}) {
  const total = collectedInr + pendingInr;
  if (total === 0) {
    return (
      <div className="border-2 border-ink bg-bone p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
          % Collected
        </p>
        <p className="tnum mt-2 font-display text-5xl font-black tracking-tight text-ink/30">
          —
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
          no fees due
        </p>
      </div>
    );
  }
  const pct = Math.round((collectedInr / total) * 100);
  const allPaid = pct === 100;
  return (
    <div
      className={`border-2 p-5 ${allPaid ? "border-moss bg-moss/5" : "border-ink bg-bone"}`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
        % Collected
      </p>
      <p
        className={`tnum mt-2 font-display text-5xl font-black tracking-tight ${allPaid ? "text-moss" : ""}`}
      >
        {pct}
        <span className="ml-1 text-2xl text-ink/50">%</span>
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
        of ₹{total.toLocaleString("en-IN")} expected
      </p>
    </div>
  );
}

function QuickLink({ href, title, desc, external }: { href: string; title: string; desc: string; external?: boolean }) {
  const className = "block border-2 border-ink p-5 transition hover:-translate-y-0.5 hover:bg-kraft/30";
  const inner = (
    <>
      <p className="font-display text-xl font-black tracking-tight">{title}</p>
      <p className="mt-1 font-mono text-xs text-ink/60">{desc}</p>
    </>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <PendingLink href={href} prefetch className={className}>
      {inner}
    </PendingLink>
  );
}

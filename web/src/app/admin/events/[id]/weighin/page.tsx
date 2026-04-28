import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { resolveEventRef } from "@/lib/db/resolve-event";
import LiveRefresh from "@/components/LiveRefresh";
import PendingLink from "@/components/PendingLink";
import WeighInQueue, { type WeighInRow } from "@/components/admin/WeighInQueue";

export const dynamic = "force-dynamic";

export default async function WeighInQueuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idOrSlug } = await params;
  const ref = await resolveEventRef(idOrSlug);
  if (!ref) redirect("/admin/events?gone=event");
  const eventId = ref.id;
  const eventSlug = ref.slug;
  const event = ref;
  await requireRole("operator", `/admin/events/${eventSlug}/weighin`);
  const svc = createServiceClient();

  // resolveEventRef gave us name+status; only the registrations rows
  // need a round-trip now. Payment is NOT a prerequisite for weigh-in:
  // we surface unpaid athletes too so floor staff can capture weight,
  // and the row badge calls out the missing payment.
  const { data: rows, error } = await svc
    .from("registrations")
    .select(
      "id, event_id, chest_no, full_name, initial, division, district, declared_weight_kg, weight_class_code, status, checkin_status, weigh_ins(id, measured_kg, weighed_at), payments(id, status, amount_inr)"
    )
    .eq("event_id", eventId)
    // Lifecycle gate — only active athletes belong in the queue.
    // Withdrawn/DQ rows are surfaced on the registrations grid instead.
    .not("status", "in", "(withdrawn,disqualified)")
    .order("chest_no", { ascending: true, nullsFirst: false })
    .limit(2000);

  return (
    <div className="space-y-8">
      <LiveRefresh tables={["registrations", "weigh_ins"]} eventId={eventId} />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">
          {event.name} · Match-day console
        </p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight">
          Weigh-in queue
        </h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Weigh-in is open to every registered athlete — payment can be
          settled later. Rows with unverified payment are flagged so you
          can chase the dues, but their weight is still captured.
        </p>
        <PendingLink
          href={`/admin/events/${eventSlug}`}
          prefetch
          className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.2em] underline hover:text-rust"
        >
          ← event
        </PendingLink>
      </div>

      {error && (
        <div className="border-2 border-rust bg-rust/10 p-3 font-mono text-xs text-rust">
          {error.message}
        </div>
      )}

      <WeighInQueue rows={(rows ?? []) as WeighInRow[]} eventSlug={eventSlug} />
    </div>
  );
}
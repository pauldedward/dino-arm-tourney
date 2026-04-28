import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { resolveEventRef } from "@/lib/db/resolve-event";
import { TN_DISTRICTS } from "@/lib/rules/tn-districts";
import PendingLink from "@/components/PendingLink";
import BulkRegistrationDesk, {
  type SavedRow,
} from "@/components/admin/BulkRegistrationDesk";

export const dynamic = "force-dynamic";

/**
 * Counter desk — operator's walk-in registration screen. One athlete at a
 * time, save-as-you-go, with payment + weigh-in inline. Sits between the
 * event dashboard and the registrations table in the operator flow:
 *   dashboard → counter desk (add) ⇄ registrations (review/verify)
 */
export default async function CounterDeskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("operator", "/admin/events");
  const { id: idOrSlug } = await params;
  const ref = await resolveEventRef(idOrSlug);
  if (!ref) redirect("/admin/events?gone=event");

  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select("id, slug, name, starts_at, entry_fee_default_inr, payment_mode, upi_id")
    .eq("id", ref.id)
    .maybeSingle();
  if (!event) redirect("/admin/events?gone=event");

  // Recent-saves sidebar is populated client-side via
  // /api/admin/registrations/recent-bulk so the initial render isn't
  // blocked on a registrations→payments join.
  const initialSaved: SavedRow[] = [];

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">
            {event.name} · operator desk
          </p>
          <h1 className="mt-1 font-display text-3xl font-black tracking-tight">
            Counter desk
            <span className="ml-3 align-middle font-mono text-[11px] font-normal uppercase tracking-[0.2em] text-ink/50">
              fee ₹{event.entry_fee_default_inr ?? 0} · Ctrl+Enter to save
            </span>
          </h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PendingLink
            href={`/admin/events/${event.slug}/registrations`}
            prefetch
            className="border-2 border-ink px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-kraft/30"
          >
            All registrations →
          </PendingLink>
          <PendingLink
            href={`/admin/events/${event.slug}`}
            prefetch
            className="font-mono text-[10px] uppercase tracking-[0.2em] underline hover:text-rust"
          >
            ← event
          </PendingLink>
        </div>
      </div>

      <BulkRegistrationDesk
        eventId={event.id}
        eventStartsAt={event.starts_at}
        defaultFee={event.entry_fee_default_inr ?? 0}
        paymentMode={(event.payment_mode as "online_upi" | "offline" | "hybrid" | null) ?? "online_upi"}
        districts={TN_DISTRICTS}
        initialSaved={initialSaved}
      />
    </div>
  );
}

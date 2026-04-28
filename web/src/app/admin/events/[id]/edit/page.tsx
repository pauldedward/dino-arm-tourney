import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { resolveEventRef } from "@/lib/db/resolve-event";
import PendingLink from "@/components/PendingLink";
import EditEventForm from "./EditEventForm";

export const dynamic = "force-dynamic";

export default async function EventEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("super_admin", "/admin/events");
  const { id: idOrSlug } = await params;
  const ref = await resolveEventRef(idOrSlug);
  if (!ref) redirect("/admin/events?gone=event");

  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select("*")
    .eq("id", ref.id)
    .maybeSingle();
  if (!event) redirect("/admin/events?gone=event");

  // Existing operators on this org (best-effort — we just list everyone with
  // operator role for now; per-event scoping lands later).
  const { data: operators } = await svc
    .from("profiles")
    .select("id, email, full_name, invited_at, last_seen_at, disabled_at")
    .eq("role", "operator")
    .order("invited_at", { ascending: false, nullsFirst: false });

  return (
    <div className="space-y-8">
      <div>
        <PendingLink
          href={`/admin/events/${event.slug}`}
          prefetch
          className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60 hover:text-ink"
        >
          ← {event.name}
        </PendingLink>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight">
          Edit event
        </h1>
        <p className="mt-1 font-mono text-xs text-ink/50">
          Branding, payment, files, and operator invites.
        </p>
      </div>

      <EditEventForm
        event={event as unknown as EventRow}
        operators={(operators ?? []) as OperatorRow[]}
      />
    </div>
  );
}

export type EventRow = {
  id: string;
  slug: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  description: string | null;
  entry_fee_default_inr: number | null;
  entry_fee_offline_inr: number | null;
  upi_id: string | null;
  upi_payee_name: string | null;
  payment_mode: "online_upi" | "offline" | "hybrid" | null;
  bracket_format: "double_elim" | "single_elim" | "round_robin" | null;
  poster_url: string | null;
  poster_kind: "image" | "pdf" | null;
  circular_url: string | null;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  text_on_primary: string | null;
  id_card_org_name: string | null;
  id_card_event_title: string | null;
  id_card_subtitle: string | null;
  id_card_footer: string | null;
  id_card_signatory_name: string | null;
  id_card_signatory_title: string | null;
};

export type OperatorRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  invited_at: string | null;
  last_seen_at: string | null;
  disabled_at: string | null;
};

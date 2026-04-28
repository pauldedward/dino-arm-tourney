import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/db/supabase-service";
import { resolveEventRef } from "@/lib/db/resolve-event";
import { requireRole } from "@/lib/auth/roles";
import BrandingForm from "./BrandingForm";

export const dynamic = "force-dynamic";

export default async function BrandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("super_admin", "/admin/events");
  const { id: idOrSlug } = await params;
  const ref = await resolveEventRef(idOrSlug);
  if (!ref) redirect("/admin/events?gone=event");
  const id = ref.id;
  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select("id, name, slug, primary_color, accent_color, text_on_primary, logo_url, id_card_org_name, id_card_event_title, id_card_subtitle, id_card_footer, id_card_signatory_name, id_card_signatory_title, id_card_signature_url, id_card_org_name_size, id_card_event_title_size")
    .eq("id", id)
    .maybeSingle();
  if (!event) redirect("/admin/events?gone=event");

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">
          Branding · {event.name}
        </p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight">
          ID card & theme
        </h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Every PDF and public page pulls from these fields — no hard-coded
          strings anywhere in the app.
        </p>
      </div>
      <BrandingForm event={event} />
    </div>
  );
}

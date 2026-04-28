import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import RegistrationsTable from "@/components/RegistrationsTable";

export const dynamic = "force-dynamic";

export default async function EventRegistrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string; division?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("id, name, slug").eq("id", id).maybeSingle();
  if (!event) notFound();

  let q = admin
    .from("registrations")
    .select(
      "id, chest_no, full_name, division, district, team, declared_weight_kg, status, age_categories, mobile, photo_url, payments(id, amount_inr, status, utr)"
    )
    .eq("event_id", id)
    .order("chest_no", { ascending: true });
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.division) q = q.eq("division", sp.division);
  if (sp.q) q = q.or(`full_name.ilike.%${sp.q}%,mobile.ilike.%${sp.q}%`);

  const { data: rows } = await q;

  return (
    <div className="space-y-6">
      <Link href={`/admin/events/${id}`} className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60 hover:text-ink">
        ← {event.name}
      </Link>
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-5xl tracking-tight2">Registrations</h1>
        <a
          href={`/api/registrations/export?event_id=${id}`}
          className="border-2 border-ink bg-bone px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-volt"
        >
          Export CSV
        </a>
      </div>

      <RegistrationsTable rows={(rows ?? []) as never} eventId={id} />
    </div>
  );
}

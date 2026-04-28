import { createAdminClient } from "@/lib/supabase/admin";
import RegistrationsTable from "@/components/RegistrationsTable";

export const dynamic = "force-dynamic";

export default async function AllRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; division?: string; event_id?: string }>;
}) {
  const sp = await searchParams;
  const admin = createAdminClient();
  let q = admin
    .from("registrations")
    .select(
      "id, chest_no, full_name, division, district, team, declared_weight_kg, status, age_categories, mobile, photo_url, event_id, events(name, slug), payments(id, amount_inr, status, utr)"
    )
    .order("chest_no", { ascending: true })
    .limit(500);
  if (sp.event_id) q = q.eq("event_id", sp.event_id);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.division) q = q.eq("division", sp.division);
  if (sp.q) q = q.or(`full_name.ilike.%${sp.q}%,mobile.ilike.%${sp.q}%`);

  const { data: rows } = await q;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-5xl tracking-tight2">All registrations</h1>
        <a
          href={`/api/registrations/export${sp.event_id ? `?event_id=${sp.event_id}` : ""}`}
          className="border-2 border-ink bg-bone px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-volt"
        >
          Export CSV
        </a>
      </div>
      <RegistrationsTable rows={(rows ?? []) as never} showEvent />
    </div>
  );
}

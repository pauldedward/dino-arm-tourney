import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  chest_no: number | null;
  full_name: string | null;
  division: string | null;
  declared_weight_kg: number | null;
  status: string;
  events: { name: string; slug: string } | null;
};

export default async function WeighInListPage({
  searchParams,
}: {
  searchParams: Promise<{ event_id?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const admin = createAdminClient();
  let q = admin
    .from("registrations")
    .select(
      "id, chest_no, full_name, division, declared_weight_kg, status, events(name, slug)"
    )
    .in("status", ["paid", "weighed_in"])
    .order("chest_no", { ascending: true })
    .limit(500);
  if (sp.event_id) q = q.eq("event_id", sp.event_id);
  if (sp.status) q = q.eq("status", sp.status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-5xl tracking-tight2">Weigh-in queue</h1>
      <div className="border-2 border-ink overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink bg-ink/5">
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em]">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Division</th>
              <th className="px-3 py-2">Declared kg</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ink/10">
                <td className="px-3 py-2 tnum font-bold">{r.chest_no}</td>
                <td className="px-3 py-2">{r.full_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.division}</td>
                <td className="px-3 py-2 tnum">{r.declared_weight_kg}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.events?.slug}</td>
                <td className="px-3 py-2">
                  <span className="border border-ink px-1 font-mono text-[10px] uppercase">{r.status}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/weighin/${r.id}`} className="font-mono text-xs underline hover:text-blood">
                    Weigh →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center font-mono text-xs text-ink/60">
                  Nothing to weigh in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

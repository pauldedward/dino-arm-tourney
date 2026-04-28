import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  starts_at: string;
  registration_published_at: string | null;
  registration_closed_at: string | null;
};

export default async function EventsListPage() {
  const sess = await getSession();
  const admin = createAdminClient();
  const { data } = await admin
    .from("events")
    .select(
      "id, slug, name, status, starts_at, registration_published_at, registration_closed_at"
    )
    .order("starts_at", { ascending: false });
  const events = (data ?? []) as EventRow[];

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-5xl tracking-tight2">Events</h1>
        {isSuperAdmin(sess.role) && (
          <Link
            href="/admin/events/new"
            className="border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood"
          >
            + New event
          </Link>
        )}
      </div>

      <div className="border-2 border-ink">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink bg-ink/5">
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em]">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Registration</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-ink/10">
                <td className="px-3 py-2 font-display">{e.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.slug}</td>
                <td className="px-3 py-2 tnum">{new Date(e.starts_at).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <span className="border border-ink px-2 py-0.5 font-mono text-[10px] uppercase">
                    {e.status}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{regStatus(e)}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/events/${e.id}`} className="underline hover:text-blood">
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center font-mono text-xs text-ink/60">
                  No events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function regStatus(e: EventRow): string {
  if (!e.registration_published_at) return "Not published";
  if (e.registration_closed_at) return "Closed";
  return "Open";
}

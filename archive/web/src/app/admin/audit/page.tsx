import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; event_id?: string; actor?: string; limit?: string }>;
}) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) redirect("/admin");
  const sp = await searchParams;
  const limit = Math.min(Number(sp.limit ?? "200"), 1000);

  const admin = createAdminClient();
  let q = admin
    .from("audit_log")
    .select("id, created_at, action, actor_label, target_table, target_id, payload, client_ip, event_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (sp.action) q = q.eq("action", sp.action);
  if (sp.event_id) q = q.eq("event_id", sp.event_id);
  if (sp.actor) q = q.ilike("actor_label", `%${sp.actor}%`);

  const { data: rows } = await q;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-5xl tracking-tight2">Audit log</h1>

      <form className="flex flex-wrap gap-3 border-2 border-ink p-4">
        <input name="action" defaultValue={sp.action ?? ""} placeholder="action (e.g. payment.verify)" className="border-2 border-ink bg-bone px-3 py-2 font-mono text-xs" />
        <input name="actor" defaultValue={sp.actor ?? ""} placeholder="actor name/email" className="border-2 border-ink bg-bone px-3 py-2 font-mono text-xs" />
        <input name="event_id" defaultValue={sp.event_id ?? ""} placeholder="event_id" className="border-2 border-ink bg-bone px-3 py-2 font-mono text-xs" />
        <input name="limit" defaultValue={String(limit)} placeholder="limit" className="w-20 border-2 border-ink bg-bone px-3 py-2 font-mono text-xs tnum" />
        <button className="border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood">
          Filter
        </button>
        <a href="/api/audit/export" className="border-2 border-ink bg-bone px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-volt">
          Export CSV
        </a>
      </form>

      <div className="border-2 border-ink overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink bg-ink/5">
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em]">
              <th className="px-2 py-2">Time</th>
              <th className="px-2 py-2">Action</th>
              <th className="px-2 py-2">Actor</th>
              <th className="px-2 py-2">Target</th>
              <th className="px-2 py-2">Payload</th>
              <th className="px-2 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-b border-ink/10">
                <td className="px-2 py-2 font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-2 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-2 py-2 font-mono text-xs">{r.actor_label}</td>
                <td className="px-2 py-2 font-mono text-[10px]">
                  {r.target_table}/{r.target_id?.slice(0, 8)}
                </td>
                <td className="px-2 py-2 font-mono text-[10px] text-ink/70">
                  {r.payload ? JSON.stringify(r.payload) : ""}
                </td>
                <td className="px-2 py-2 font-mono text-[10px] text-ink/50">{r.client_ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

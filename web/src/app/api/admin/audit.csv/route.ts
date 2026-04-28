import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { exportFilename } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV export of the audit log for the super admin.
 *
 * Same filter semantics as /admin/audit (event, action prefix, actor, since).
 * Hard-capped to 10k rows to keep memory bounded.
 */
export async function GET(req: NextRequest) {
  await requireRole("super_admin", "/admin/audit");

  const sp = req.nextUrl.searchParams;
  const svc = createServiceClient();
  let q = svc
    .from("audit_log")
    .select(
      "created_at, event_id, actor_id, actor_label, action, target_table, target_id, payload, client_ip"
    )
    .order("created_at", { ascending: false })
    .limit(10000);

  const event = sp.get("event");
  const action = sp.get("action");
  const actor = sp.get("actor");
  const since = sp.get("since");
  if (event) q = q.eq("event_id", event);
  if (action) q = q.ilike("action", `${action}%`);
  if (actor) q = q.eq("actor_id", actor);
  if (since) q = q.gte("created_at", since);

  // Look up the event so the filename reads like
  // `tn-state-2026-audit-log-2026-04-27.csv` instead of `audit-2026-04-27.csv`.
  const eventMeta = event
    ? await svc.from("events").select("name, slug").eq("id", event).maybeSingle()
    : null;

  const { data, error } = await q;
  if (error) return new Response(error.message, { status: 500 });

  const header = [
    "created_at",
    "event_id",
    "actor_id",
    "actor_label",
    "action",
    "target_table",
    "target_id",
    "payload",
    "client_ip",
  ];
  const lines = [header.join(",")];
  for (const r of data ?? []) {
    lines.push(
      [
        r.created_at,
        r.event_id ?? "",
        r.actor_id ?? "",
        r.actor_label ?? "",
        r.action,
        r.target_table ?? "",
        r.target_id ?? "",
        r.payload ? JSON.stringify(r.payload) : "",
        r.client_ip ?? "",
      ]
        .map(csv)
        .join(",")
    );
  }

  const filename = exportFilename({
    eventSlug: eventMeta?.data?.slug ?? null,
    eventName: eventMeta?.data?.name ?? null,
    kind: "audit-log",
    ext: "csv",
  });
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function csv(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

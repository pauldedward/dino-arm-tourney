import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * DELETE /api/admin/registrations/bulk
 *
 * Body: { ids: string[] }
 *
 * Cascade deletes via FK. Returns { ok, deleted, missing }.
 */
export async function DELETE(req: NextRequest) {
  const session = await requireRole("operator", "/admin");

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? (body.ids.filter((x) => typeof x === "string" && x.length > 0) as string[])
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "no ids" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "too many ids (max 500)" }, { status: 400 });
  }

  const svc = createServiceClient();

  const { data: existing, error: selErr } = await svc
    .from("registrations")
    .select("id, event_id, full_name, chest_no, athlete_id, status")
    .in("id", ids);
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  const found = existing ?? [];
  if (found.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, missing: ids.length });
  }

  const foundIds = found.map((r) => r.id);
  const { error: delErr } = await svc
    .from("registrations")
    .delete()
    .in("id", foundIds);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  await Promise.all(
    found.map((r) =>
      recordAudit({
        eventId: r.event_id,
        actorId: session.userId,
        actorLabel: session.fullName ?? session.email,
        action: "registration.delete",
        targetTable: "registrations",
        targetId: r.id,
        payload: {
          full_name: r.full_name,
          chest_no: r.chest_no,
          athlete_id: r.athlete_id,
          prior_status: r.status,
          bulk: true,
        },
      })
    )
  );

  return NextResponse.json({
    ok: true,
    deleted: found.length,
    missing: ids.length - found.length,
  });
}

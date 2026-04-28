import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/events/[id]/categories/[code]/table
// Body: { table_no: number | null }
//
// Each category at this venue runs on exactly one physical table. Persist
// that as `mat_no` on every fixture in the (event, category_code) pair
// that has not yet completed. The legacy `categories` row (if any) is
// not in play for the live ops path — fixtures are the source of truth
// here.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; code: string }> },
) {
  const session = await requireRole("operator", "/admin");
  const { id: eventIdOrSlug, code: rawCode } = await ctx.params;
  // Category codes contain U+2212 (−) and arrive URL-encoded.
  let code = rawCode;
  try { code = decodeURIComponent(rawCode); } catch {}
  const body = (await req.json().catch(() => ({}))) as {
    table_no?: number | null;
  };
  const tableNo =
    body.table_no === null
      ? null
      : typeof body.table_no === "number" &&
          Number.isInteger(body.table_no) &&
          body.table_no > 0 &&
          body.table_no < 1000
        ? body.table_no
        : undefined;
  if (tableNo === undefined) {
    return NextResponse.json(
      { error: "table_no must be a positive integer (< 1000) or null" },
      { status: 422 },
    );
  }

  const svc = createServiceClient();
  const looksUuid = /^[0-9a-f]{8}-/.test(eventIdOrSlug);
  const { data: event, error: evErr } = await svc
    .from("events")
    .select("id")
    .eq(looksUuid ? "id" : "slug", eventIdOrSlug)
    .maybeSingle();
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
  if (!event)
    return NextResponse.json({ error: "event not found" }, { status: 404 });

  const { data: updated, error: fxErr } = await svc
    .from("fixtures")
    .update({ mat_no: tableNo })
    .eq("event_id", event.id)
    .eq("category_code", code)
    .in("status", ["scheduled", "in_progress"])
    .select("id");
  if (fxErr) return NextResponse.json({ error: fxErr.message }, { status: 500 });

  await recordAudit({
    eventId: event.id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "category.table_set",
    targetTable: "fixtures",
    targetId: null,
    payload: {
      category_code: code,
      table_no: tableNo,
      affected_fixtures: updated?.length ?? 0,
    },
  });

  return NextResponse.json({
    ok: true,
    table_no: tableNo,
    affected_fixtures: updated?.length ?? 0,
  });
}

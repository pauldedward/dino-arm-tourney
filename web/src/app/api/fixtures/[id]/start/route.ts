import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/fixtures/[id]/start
// Body: { mat_no?: number }
// Marks a scheduled fixture as in_progress. Idempotent — re-calling on
// an already in_progress row only updates mat_no.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("operator", "/admin");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { mat_no?: number | null };
  const explicit =
    typeof body.mat_no === "number" && Number.isInteger(body.mat_no)
      ? body.mat_no
      : null;

  const svc = createServiceClient();
  const { data: fx, error: getErr } = await svc
    .from("fixtures")
    .select("id, event_id, category_code, mat_no, status, entry_a_id, entry_b_id")
    .eq("id", id)
    .maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!fx) return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  if (fx.status === "completed" || fx.status === "void") {
    return NextResponse.json(
      { error: `fixture already ${fx.status}` },
      { status: 409 },
    );
  }
  if (!fx.entry_a_id || !fx.entry_b_id) {
    return NextResponse.json(
      { error: "fixture is incomplete (missing entry on one side)" },
      { status: 422 },
    );
  }

  // Resolve table assignment: explicit body wins, else inherit any other
  // fixture's mat_no in this category (set by the bulk table assignment),
  // else fall back to the row's own current mat_no.
  let matNo: number | null = explicit ?? fx.mat_no ?? null;
  if (matNo == null) {
    const { data: sibling } = await svc
      .from("fixtures")
      .select("mat_no")
      .eq("event_id", fx.event_id)
      .eq("category_code", fx.category_code)
      .not("mat_no", "is", null)
      .limit(1)
      .maybeSingle();
    if (sibling?.mat_no != null) matNo = sibling.mat_no;
  }

  const now = new Date().toISOString();
  const { error: upErr } = await svc
    .from("fixtures")
    .update({
      status: "in_progress",
      mat_no: matNo,
      started_at: now,
      updated_by: session.userId,
      updated_at: now,
    })
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await recordAudit({
    eventId: fx.event_id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "fixture.start",
    targetTable: "fixtures",
    targetId: id,
    payload: { mat_no: matNo },
  });

  return NextResponse.json({ ok: true, status: "in_progress", mat_no: matNo });
}

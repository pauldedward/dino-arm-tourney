import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/fixtures/[id]/void
// Body: { reason?: string }
//
// Marks a fixture as void (e.g. both athletes injured / pulled).
// Does NOT auto-advance — operator must manually adjust downstream
// pairings. Use sparingly.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "/admin");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };

  const svc = createServiceClient();
  const { data: fx } = await svc
    .from("fixtures")
    .select("id, event_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!fx) return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  if (fx.status === "completed") {
    return NextResponse.json(
      { error: "completed fixture cannot be voided; undo first" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const { error } = await svc
    .from("fixtures")
    .update({
      status: "void",
      updated_by: session.userId,
      updated_at: now,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    eventId: fx.event_id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "fixture.void",
    targetTable: "fixtures",
    targetId: id,
    payload: { reason: body.reason ?? null },
  });

  return NextResponse.json({ ok: true });
}

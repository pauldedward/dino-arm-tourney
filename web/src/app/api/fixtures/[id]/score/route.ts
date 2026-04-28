import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/fixtures/[id]/score
// Body: { score_a: number, score_b: number }
// Update game-win counters mid-match. Used for best-of-N matches where
// the operator clicks "A wins this game" repeatedly. The route never
// closes the match; the operator (or the client logic) calls /complete
// when a player reaches the win threshold.
//
// Bounds: scores must be non-negative integers and fit smallint. We do
// NOT enforce best_of here because the source of truth for that is the
// fixture row + bracket builder; the client is responsible for not
// double-counting.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("operator", "/admin");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    score_a?: number;
    score_b?: number;
  };

  const sa = body.score_a;
  const sb = body.score_b;
  const valid = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 50;
  if (!valid(sa) || !valid(sb)) {
    return NextResponse.json(
      { error: "score_a and score_b must be non-negative integers" },
      { status: 422 },
    );
  }

  const svc = createServiceClient();
  const { data: fx, error: getErr } = await svc
    .from("fixtures")
    .select("id, event_id, status")
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

  const now = new Date().toISOString();
  const { error: upErr } = await svc
    .from("fixtures")
    .update({
      score_a: sa,
      score_b: sb,
      updated_by: session.userId,
      updated_at: now,
    })
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await recordAudit({
    eventId: fx.event_id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "fixture.score",
    targetTable: "fixtures",
    targetId: id,
    payload: { score_a: sa, score_b: sb },
  });

  return NextResponse.json({ ok: true, score_a: sa, score_b: sb });
}

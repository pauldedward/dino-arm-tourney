import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const VALID_METHODS = new Set([
  "points",
  "pin",
  "disqualification",
  "walkover",
  "forfeit",
  "injury",
]);

// POST /api/fixtures/[id]/complete
// Body: { winner: 'A' | 'B', score_a?: number, score_b?: number, method?: string }
//
// Atomically closes the fixture and routes the winner (and loser, in
// double-elim) to the next slot via the apply_fixture_complete RPC.
// Errors map RPC SQLSTATEs to HTTP:
//   P0001 → 409 (winner conflict / downstream slot collision)
//   P0002 → 409 (downstream match already in progress)
//   P0003 → 404 (fixture not found)
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("operator", "/admin");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    winner?: string;
    score_a?: number | null;
    score_b?: number | null;
    method?: string | null;
  };

  if (body.winner !== "A" && body.winner !== "B") {
    return NextResponse.json(
      { error: "winner must be 'A' or 'B'" },
      { status: 400 },
    );
  }
  const method =
    body.method && VALID_METHODS.has(body.method) ? body.method : null;
  const scoreA =
    typeof body.score_a === "number" && Number.isInteger(body.score_a)
      ? body.score_a
      : null;
  const scoreB =
    typeof body.score_b === "number" && Number.isInteger(body.score_b)
      ? body.score_b
      : null;

  const svc = createServiceClient();
  const { data: fx } = await svc
    .from("fixtures")
    .select("id, event_id, category_code")
    .eq("id", id)
    .maybeSingle();
  if (!fx) return NextResponse.json({ error: "fixture not found" }, { status: 404 });

  const { data, error } = await svc.rpc("apply_fixture_complete", {
    p_fixture_id: id,
    p_winner: body.winner,
    p_score_a: scoreA,
    p_score_b: scoreB,
    p_method: method,
    p_actor: session.userId,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    const status =
      code === "P0001" || code === "P0002"
        ? 409
        : code === "P0003"
        ? 404
        : code === "22023"
        ? 422
        : 500;
    return NextResponse.json({ error: error.message, code }, { status });
  }

  await recordAudit({
    eventId: fx.event_id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "fixture.complete",
    targetTable: "fixtures",
    targetId: id,
    payload: {
      category_code: fx.category_code,
      winner: body.winner,
      score_a: scoreA,
      score_b: scoreB,
      method,
      affected: data,
    },
  });

  return NextResponse.json({ ok: true, affected: data });
}

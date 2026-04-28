import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/fixtures/[id]/undo
//
// Reverts a completed fixture to in_progress (winner cleared, scores
// kept for audit). Refuses if any downstream fixture that was filled by
// this result is already started or completed — operator must undo from
// the leaf inward. Caller (super_admin only) reviews the chain manually.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "/admin");
  const { id } = await ctx.params;

  const svc = createServiceClient();
  const { data: fx, error: getErr } = await svc
    .from("fixtures")
    .select(
      "id, event_id, category_code, status, winner_entry_id, bracket_side, round_no, match_no, next_round_no, next_match_no, next_bracket_side, loser_next_round_no, loser_next_match_no, loser_next_bracket_side",
    )
    .eq("id", id)
    .maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!fx) return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  if (fx.status !== "completed") {
    return NextResponse.json(
      { error: `fixture is ${fx.status}, can only undo completed` },
      { status: 409 },
    );
  }

  // Look up downstream slots and refuse if any started.
  const downstream: Array<{
    bracket_side: "W" | "L" | "GF";
    round_no: number;
    match_no: number;
  }> = [];
  if (fx.next_round_no != null && fx.next_match_no != null) {
    downstream.push({
      bracket_side: (fx.next_bracket_side ?? fx.bracket_side) as "W" | "L" | "GF",
      round_no: fx.next_round_no,
      match_no: fx.next_match_no,
    });
  }
  if (fx.loser_next_round_no != null && fx.loser_next_match_no != null) {
    downstream.push({
      bracket_side: (fx.loser_next_bracket_side ?? "L") as "W" | "L" | "GF",
      round_no: fx.loser_next_round_no,
      match_no: fx.loser_next_match_no,
    });
  }

  let downstreamRows: Array<{
    id: string;
    status: string;
    bracket_side: string;
    round_no: number;
    match_no: number;
    entry_a_id: string | null;
    entry_b_id: string | null;
  }> = [];
  if (downstream.length > 0) {
    const { data, error } = await svc
      .from("fixtures")
      .select("id, status, bracket_side, round_no, match_no, entry_a_id, entry_b_id")
      .eq("event_id", fx.event_id)
      .eq("category_code", fx.category_code)
      .in(
        "bracket_side",
        Array.from(new Set(downstream.map((d) => d.bracket_side))),
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    downstreamRows = (data ?? []).filter((r) =>
      downstream.some(
        (d) =>
          d.bracket_side === r.bracket_side &&
          d.round_no === r.round_no &&
          d.match_no === r.match_no,
      ),
    );
  }
  const blocked = downstreamRows.find(
    (r) => r.status === "in_progress" || r.status === "completed",
  );
  if (blocked) {
    return NextResponse.json(
      {
        error: "downstream fixture already in_progress/completed; undo it first",
        blocked: blocked.id,
      },
      { status: 409 },
    );
  }

  // Clear the winner slot in each downstream fixture (parity-based).
  const winnerEntryId = fx.winner_entry_id;
  for (const d of downstreamRows) {
    const targetSide = fx.match_no % 2 === 1 ? "A" : "B";
    const sideCol = targetSide === "A" ? "entry_a_id" : "entry_b_id";
    const current = targetSide === "A" ? d.entry_a_id : d.entry_b_id;
    if (current === winnerEntryId || current != null) {
      await svc
        .from("fixtures")
        .update({ [sideCol]: null, updated_by: session.userId, updated_at: new Date().toISOString() })
        .eq("id", d.id);
    }
  }

  // Reopen the source fixture.
  const now = new Date().toISOString();
  const { error: upErr } = await svc
    .from("fixtures")
    .update({
      status: "in_progress",
      winner_entry_id: null,
      completed_at: null,
      updated_by: session.userId,
      updated_at: now,
    })
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await recordAudit({
    eventId: fx.event_id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "fixture.undo",
    targetTable: "fixtures",
    targetId: id,
    payload: {
      previous_winner_entry_id: winnerEntryId,
      cleared_downstream: downstreamRows.map((r) => r.id),
    },
  });

  return NextResponse.json({ ok: true });
}

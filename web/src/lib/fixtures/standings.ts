// Computes per-entry rank for a single category from its fixture list.
//
// Pure function — input is the array of fixtures (one category, all
// bracket sides) and the output is one row per distinct entry that
// appeared in at least one fixture, ordered best to worst.

export type FixtureStatus = "scheduled" | "in_progress" | "completed" | "void";
export type BracketSide = "W" | "L" | "GF";

export interface StandingFixture {
  bracket_side: BracketSide;
  round_no: number;
  match_no: number;
  entry_a_id: string | null;
  entry_b_id: string | null;
  winner_entry_id: string | null;
  status: FixtureStatus;
}

export interface Standing {
  rank: number;
  entry_id: string;
}

export function computeCategoryStandings(rows: StandingFixture[]): Standing[] {
  // GF result decides 1/2 in double-elim. Else fall back to the WB final
  // (single-elim) — the W row with the highest round_no.
  const gf = rows.find((r) => r.bracket_side === "GF" && r.status === "completed");
  let gold: string | null = null;
  let silver: string | null = null;
  let isDoubleElim = false;

  if (gf && gf.winner_entry_id) {
    isDoubleElim = true;
    gold = gf.winner_entry_id;
    silver = gf.entry_a_id === gold ? gf.entry_b_id : gf.entry_a_id;
  } else {
    const wbCompleted = rows.filter(
      (r) => r.bracket_side === "W" && r.status === "completed" && r.winner_entry_id,
    );
    if (wbCompleted.length === 0) return [];
    const wbFinal = wbCompleted.reduce((acc, r) =>
      r.round_no > acc.round_no ? r : acc,
    );
    gold = wbFinal.winner_entry_id;
    silver =
      wbFinal.entry_a_id === gold ? wbFinal.entry_b_id : wbFinal.entry_a_id;
  }

  const out: Standing[] = [];
  if (gold) out.push({ rank: 1, entry_id: gold });
  if (silver) out.push({ rank: 2, entry_id: silver });

  if (isDoubleElim) {
    // Bronze: LB final loser. Single bronze in standard double-elim.
    const lbCompleted = rows.filter(
      (r) => r.bracket_side === "L" && r.status === "completed" && r.winner_entry_id,
    );
    if (lbCompleted.length > 0) {
      const lbFinal = lbCompleted.reduce((acc, r) =>
        r.round_no > acc.round_no ? r : acc,
      );
      const bronze =
        lbFinal.entry_a_id === lbFinal.winner_entry_id
          ? lbFinal.entry_b_id
          : lbFinal.entry_a_id;
      if (bronze) out.push({ rank: 3, entry_id: bronze });
    }
  } else {
    // Single-elim bronze: both losers of the WB semi-finals (round below
    // the final). Tied at rank 3.
    const wbCompleted = rows.filter(
      (r) => r.bracket_side === "W" && r.status === "completed" && r.winner_entry_id,
    );
    const finalRound = Math.max(...wbCompleted.map((r) => r.round_no));
    if (finalRound > 1) {
      const semis = wbCompleted.filter((r) => r.round_no === finalRound - 1);
      for (const s of semis) {
        const loser = s.entry_a_id === s.winner_entry_id ? s.entry_b_id : s.entry_a_id;
        if (loser) out.push({ rank: 3, entry_id: loser });
      }
    }
  }
  return out;
}

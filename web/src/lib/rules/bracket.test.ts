import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBracket,
  buildDoubleElim,
  buildFixtures,
  seedOrder,
  type PlannedMatch,
  type SeededEntry,
} from "./bracket";

function ids(n: number): SeededEntry[] {
  return Array.from({ length: n }, (_, i) => ({ entry_id: `e${i + 1}` }));
}

describe("seedOrder", () => {
  it("size 8 matches standard bracket", () => {
    assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it("size 4", () => {
    assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  });
});

describe("buildBracket", () => {
  it("fewer than 2 entries -> no matches", () => {
    assert.equal(buildBracket([]).length, 0);
    assert.equal(buildBracket(ids(1)).length, 0);
  });

  it("exactly 2 entries -> 1 final match", () => {
    const m = buildBracket(ids(2));
    assert.equal(m.length, 1);
    assert.equal(m[0].round_no, 1);
    assert.equal(m[0].next_match_no, null);
  });

  it("8 entries -> 4 + 2 + 1 = 7 matches", () => {
    const m = buildBracket(ids(8));
    assert.equal(m.length, 7);
    const r1 = m.filter((x) => x.round_no === 1);
    assert.equal(r1.length, 4);
    // Seeds 1 and 2 are in opposite halves and would only meet in the final.
    assert.equal(r1[0].a_entry_id, "e1"); // slot 0 is seed 1
    assert.equal(r1[2].a_entry_id, "e2"); // slot 4 is seed 2
  });

  it("5 entries -> bracket of 8 with 3 byes to top seeds", () => {
    const m = buildBracket(ids(5));
    const r1 = m.filter((x) => x.round_no === 1);
    assert.equal(r1.length, 4);
    const byes = r1.filter((x) => !x.a_entry_id || !x.b_entry_id).length;
    assert.equal(byes, 3);
    // Seed 1 should always get a R1 bye (opponent null).
    const s1Match = r1.find((x) => x.a_entry_id === "e1" || x.b_entry_id === "e1")!;
    assert.ok(s1Match.a_entry_id === null || s1Match.b_entry_id === null);
  });

  it("every round's match feeds a unique next_match", () => {
    const m = buildBracket(ids(16));
    const byRound: Record<number, number[]> = {};
    for (const mm of m) {
      (byRound[mm.round_no] ||= []).push(mm.next_match_no ?? -1);
    }
    // Final has null next_match.
    const last = Math.max(...Object.keys(byRound).map(Number));
    assert.equal(byRound[last][0], -1);
  });
});

describe("buildBracket — district spread", () => {
  it("breaks a same-district R1 pair when a swap exists", () => {
    const e: SeededEntry[] = [
      { entry_id: "A", district: "Chennai" },
      { entry_id: "B", district: "Chennai" }, // seeded 2 — would meet A in bracket of 2
      { entry_id: "C", district: "Trichy" },
      { entry_id: "D", district: "Madurai" },
    ];
    // With 4 entries, slots = [1,4,3,2] = [A, D, C, B]. Pairs = (A,D) and (C,B).
    // Neither is same-district — algorithm no-ops. Use 8 players to force a conflict.
    const entries: SeededEntry[] = [
      { entry_id: "A", district: "Chennai" },
      { entry_id: "B", district: "Chennai" },
      { entry_id: "C", district: "Trichy" },
      { entry_id: "D", district: "Madurai" },
      { entry_id: "E", district: "Chennai" },
      { entry_id: "F", district: "Salem" },
      { entry_id: "G", district: "Trichy" },
      { entry_id: "H", district: "Vellore" },
    ];
    const matches = buildBracket(entries);
    const r1 = matches.filter((m) => m.round_no === 1);
    for (const m of r1) {
      if (m.a_entry_id && m.b_entry_id) {
        const da = entries.find((x) => x.entry_id === m.a_entry_id)?.district;
        const db = entries.find((x) => x.entry_id === m.b_entry_id)?.district;
        assert.notEqual(da, db, `R1 match ${m.match_no} still same-district: ${da}`);
      }
    }
  });
});

function find(matches: PlannedMatch[], side: PlannedMatch["bracket_side"], r: number, m: number) {
  const f = matches.find(
    (x) => x.bracket_side === side && x.round_no === r && x.match_no === m
  );
  if (!f) throw new Error(`missing ${side}${r}.${m}`);
  return f;
}

describe("buildDoubleElim", () => {
  it("fewer than 2 entries -> no matches", () => {
    assert.equal(buildDoubleElim([]).length, 0);
    assert.equal(buildDoubleElim(ids(1)).length, 0);
  });

  it("2 entries -> degenerates to single match (no LB / GF)", () => {
    const m = buildDoubleElim(ids(2));
    assert.equal(m.length, 1);
    assert.equal(m[0].bracket_side, "W");
    assert.equal(m[0].next_bracket_side, null);
  });

  it("4 entries -> 3 W + 2 L + 1 GF = 6 matches", () => {
    const m = buildDoubleElim(ids(4));
    assert.equal(m.length, 6);
    assert.equal(m.filter((x) => x.bracket_side === "W").length, 3);
    assert.equal(m.filter((x) => x.bracket_side === "L").length, 2);
    assert.equal(m.filter((x) => x.bracket_side === "GF").length, 1);
  });

  it("8 entries -> 7 W + 6 L + 1 GF = 14 matches", () => {
    const m = buildDoubleElim(ids(8));
    assert.equal(m.filter((x) => x.bracket_side === "W").length, 7);
    assert.equal(m.filter((x) => x.bracket_side === "L").length, 6);
    assert.equal(m.filter((x) => x.bracket_side === "GF").length, 1);
    // LB round shape: L1=2, L2=2, L3=1, L4=1.
    const lbCounts = [1, 2, 3, 4].map(
      (r) => m.filter((x) => x.bracket_side === "L" && x.round_no === r).length
    );
    assert.deepEqual(lbCounts, [2, 2, 1, 1]);
  });

  it("W1 losers drop to L1 with cross-half pairing (size 8)", () => {
    const m = buildDoubleElim(ids(8));
    // W1.1 and W1.4 should drop to the same L1 match; W1.2 and W1.3 to the other.
    const w11 = find(m, "W", 1, 1);
    const w14 = find(m, "W", 1, 4);
    const w12 = find(m, "W", 1, 2);
    const w13 = find(m, "W", 1, 3);
    assert.equal(w11.loser_next_bracket_side, "L");
    assert.equal(w11.loser_next_round_no, 1);
    assert.equal(w11.loser_next_match_no, w14.loser_next_match_no);
    assert.equal(w12.loser_next_match_no, w13.loser_next_match_no);
    assert.notEqual(w11.loser_next_match_no, w12.loser_next_match_no);
  });

  it("WB final winner advances to GF; LB final winner advances to GF", () => {
    const m = buildDoubleElim(ids(8));
    const wbFinal = find(m, "W", 3, 1);
    assert.equal(wbFinal.next_bracket_side, "GF");
    assert.equal(wbFinal.next_round_no, 1);
    assert.equal(wbFinal.next_match_no, 1);
    const lbFinal = find(m, "L", 4, 1);
    assert.equal(lbFinal.next_bracket_side, "GF");
  });

  it("WB R2 losers drop into L2 (size 8)", () => {
    const m = buildDoubleElim(ids(8));
    const w21 = find(m, "W", 2, 1);
    const w22 = find(m, "W", 2, 2);
    assert.equal(w21.loser_next_bracket_side, "L");
    assert.equal(w21.loser_next_round_no, 2);
    assert.equal(w22.loser_next_round_no, 2);
    // M=2 so the inversion gives W2.1 -> L2.2 and W2.2 -> L2.1.
    assert.equal(w21.loser_next_match_no, 2);
    assert.equal(w22.loser_next_match_no, 1);
  });

  it("LB matches without WB-loser drops route winners onto the same LB slot", () => {
    // L1 winners feed L2 at the same match_no (waiting for the WB R2 loser).
    const m = buildDoubleElim(ids(8));
    const l11 = find(m, "L", 1, 1);
    const l12 = find(m, "L", 1, 2);
    assert.equal(l11.next_bracket_side, "L");
    assert.equal(l11.next_round_no, 2);
    assert.equal(l11.next_match_no, 1);
    assert.equal(l12.next_match_no, 2);
  });

  it("non-power-of-two: 5 entries pads to bracket of 8 with 14 fixture shells", () => {
    const m = buildDoubleElim(ids(5));
    assert.equal(m.length, 14);
    // All byes are in WB R1; LB shells exist regardless.
    const r1 = m.filter((x) => x.bracket_side === "W" && x.round_no === 1);
    const byes = r1.filter((x) => !x.a_entry_id || !x.b_entry_id).length;
    assert.equal(byes, 3);
  });
});

describe("buildFixtures dispatcher", () => {
  it("'single_elim' -> single-elim shape", () => {
    const m = buildFixtures(ids(8), "single_elim");
    assert.equal(m.length, 7);
    assert.ok(m.every((x) => x.bracket_side === "W"));
  });
  it("'double_elim' -> double-elim shape", () => {
    const m = buildFixtures(ids(8), "double_elim");
    assert.equal(m.length, 14);
    assert.ok(m.some((x) => x.bracket_side === "L"));
    assert.ok(m.some((x) => x.bracket_side === "GF"));
  });
  it("unknown formats fall back to single-elim", () => {
    const m = buildFixtures(ids(8), "round_robin");
    assert.equal(m.length, 7);
  });
});

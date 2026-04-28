import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCategoryStandings, type StandingFixture } from "./standings";

// Helper: build a fixture row with sensible defaults.
function fx(overrides: Partial<StandingFixture>): StandingFixture {
  return {
    bracket_side: "W",
    round_no: 1,
    match_no: 1,
    entry_a_id: null,
    entry_b_id: null,
    winner_entry_id: null,
    status: "scheduled",
    ...overrides,
  };
}

describe("computeCategoryStandings — double-elim happy path", () => {
  it("ranks GF winner gold, GF loser silver, LB-final loser bronze", () => {
    // 4-entry double-elim: WB has 2 R1 + 1 R2 (WB final). LB has 1 R1 + 1 R2 + 1 final.
    // Imagine entries: A,B,C,D. A beats B in WB-R1, C beats D in WB-R1.
    // A beats C in WB-final. D drops to LB-R1 against B (loser of WB-R1.1),
    // B beats D. Then C drops to LB-final, B beats C. GF: A vs B, A wins.
    const rows: StandingFixture[] = [
      fx({ bracket_side: "W", round_no: 1, match_no: 1,
           entry_a_id: "A", entry_b_id: "B",
           winner_entry_id: "A", status: "completed" }),
      fx({ bracket_side: "W", round_no: 1, match_no: 2,
           entry_a_id: "C", entry_b_id: "D",
           winner_entry_id: "C", status: "completed" }),
      fx({ bracket_side: "W", round_no: 2, match_no: 1,
           entry_a_id: "A", entry_b_id: "C",
           winner_entry_id: "A", status: "completed" }),
      fx({ bracket_side: "L", round_no: 1, match_no: 1,
           entry_a_id: "B", entry_b_id: "D",
           winner_entry_id: "B", status: "completed" }),
      fx({ bracket_side: "L", round_no: 2, match_no: 1,
           entry_a_id: "B", entry_b_id: "C",
           winner_entry_id: "B", status: "completed" }),
      fx({ bracket_side: "GF", round_no: 1, match_no: 1,
           entry_a_id: "A", entry_b_id: "B",
           winner_entry_id: "A", status: "completed" }),
    ];
    const out = computeCategoryStandings(rows);
    assert.deepEqual(
      out.slice(0, 3).map((s) => [s.rank, s.entry_id]),
      [[1, "A"], [2, "B"], [3, "C"]],
    );
  });
});

describe("computeCategoryStandings — single-elim", () => {
  it("4-entry: WB final winner=1, loser=2, both semi losers tied at 3", () => {
    // Single-elim: no LB, no GF. Final winner gold, loser silver, two
    // semi-losers tie for bronze.
    const rows: StandingFixture[] = [
      fx({ bracket_side: "W", round_no: 1, match_no: 1,
           entry_a_id: "A", entry_b_id: "B",
           winner_entry_id: "A", status: "completed" }),
      fx({ bracket_side: "W", round_no: 1, match_no: 2,
           entry_a_id: "C", entry_b_id: "D",
           winner_entry_id: "C", status: "completed" }),
      fx({ bracket_side: "W", round_no: 2, match_no: 1,
           entry_a_id: "A", entry_b_id: "C",
           winner_entry_id: "A", status: "completed" }),
    ];
    const out = computeCategoryStandings(rows);
    const top = out.map((s) => [s.rank, s.entry_id]);
    assert.deepEqual(top.slice(0, 2), [[1, "A"], [2, "C"]]);
    // Bronze tied: both B and D get rank 3 in any order.
    const bronze = top.slice(2, 4).filter((r) => r[0] === 3).map((r) => r[1]).sort();
    assert.deepEqual(bronze, ["B", "D"]);
  });

  it("2-entry: winner=1, loser=2, no bronze", () => {
    const rows: StandingFixture[] = [
      fx({ bracket_side: "W", round_no: 1, match_no: 1,
           entry_a_id: "A", entry_b_id: "B",
           winner_entry_id: "A", status: "completed" }),
    ];
    const out = computeCategoryStandings(rows);
    assert.deepEqual(
      out.map((s) => [s.rank, s.entry_id]),
      [[1, "A"], [2, "B"]],
    );
  });
});

describe("computeCategoryStandings — incomplete state", () => {
  it("returns empty when no decisive match has finished", () => {
    const rows: StandingFixture[] = [
      fx({ bracket_side: "W", round_no: 1, match_no: 1,
           entry_a_id: "A", entry_b_id: "B",
           status: "in_progress" }),
    ];
    assert.deepEqual(computeCategoryStandings(rows), []);
  });

  it("ignores void fixtures", () => {
    const rows: StandingFixture[] = [
      fx({ bracket_side: "W", round_no: 1, match_no: 1,
           entry_a_id: "A", entry_b_id: "B",
           winner_entry_id: "A", status: "void" }),
    ];
    assert.deepEqual(computeCategoryStandings(rows), []);
  });
});

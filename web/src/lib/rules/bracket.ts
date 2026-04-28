/**
 * Single-elimination bracket builder.
 *
 * Inputs:
 *   - entries in a single category (same division|age|weight|hand)
 *   - already seeded in preferred order (or left unseeded — we'll stable-sort)
 *
 * Output:
 *   - `matches`: array of `{ round_no, match_no, a_seed, b_seed }` where
 *     `a_seed`/`b_seed` is the seed index of the entry, or null for a BYE
 *     in round 1.
 *
 * Rules:
 *   - Bracket size is the next power of two >= entry count.
 *   - `byes` = size - N. Byes are distributed to the top seeds in
 *     seed-pair-positions 1 vs 2N, 2 vs (2N-1), ... so a top seed never
 *     faces another top seed in R1.
 *   - District-spread heuristic: among two athletes from the same district
 *     paired in R1, swap the lower-ranked one with the next available
 *     cross-district athlete at the same "slot-class" (avoids same-district
 *     R1 matchup where a swap exists).
 *
 * Round numbering: R1 = first non-bye round. Winners play in R2, ... final
 * round is log2(size). `next_match_no` is deterministic from (round, match).
 */

export interface SeededEntry {
  entry_id: string;
  district?: string | null;
  team?: string | null;
}

export type BracketSide = "W" | "L" | "GF";

export interface PlannedMatch {
  bracket_side: BracketSide;
  round_no: number;
  match_no: number;
  a_entry_id: string | null;
  b_entry_id: string | null;
  /** Where the WINNER of this match goes next (null = tournament-ending match). */
  next_round_no: number | null;
  next_match_no: number | null;
  next_bracket_side: BracketSide | null;
  /**
   * Where the LOSER of this match goes next. Only set for double-elim
   * winners'-bracket matches whose losers drop into the losers' bracket.
   * Null for single-elim, for losers'-bracket matches (loser is eliminated),
   * and for the grand final.
   */
  loser_next_round_no: number | null;
  loser_next_match_no: number | null;
  loser_next_bracket_side: BracketSide | null;
  /**
   * Number of games that make up this match. 1 = single game (default,
   * the WAF norm for elimination rounds). 3 = best-of-three (used for the
   * Grand Final by default — first player to 2 game wins takes the
   * match). 5 is reserved for pro-circuit overrides.
   */
  best_of: number;
}

export function buildBracket(entries: SeededEntry[]): PlannedMatch[] {
  const N = entries.length;
  if (N < 2) return [];

  const size = nextPow2(N);
  const positions = seedOrder(size); // length=size, positions[i] = seed index (1..size) at slot i
  const slots: (SeededEntry | null)[] = positions.map((seed) =>
    seed <= N ? entries[seed - 1] : null
  );

  spreadByDistrict(slots);

  const totalRounds = Math.log2(size);
  const matches: PlannedMatch[] = [];

  // Round 1 pairings from adjacent slots.
  for (let i = 0; i < size; i += 2) {
    const matchNo = i / 2 + 1;
    matches.push({
      bracket_side: "W",
      round_no: 1,
      match_no: matchNo,
      a_entry_id: slots[i]?.entry_id ?? null,
      b_entry_id: slots[i + 1]?.entry_id ?? null,
      next_round_no: totalRounds >= 2 ? 2 : null,
      next_match_no: totalRounds >= 2 ? Math.ceil(matchNo / 2) : null,
      next_bracket_side: totalRounds >= 2 ? "W" : null,
      loser_next_round_no: null,
      loser_next_match_no: null,
      loser_next_bracket_side: null,
      best_of: 1,
    });
  }

  // Subsequent rounds are empty shells — winners are threaded in at match time.
  for (let r = 2; r <= totalRounds; r++) {
    const count = size / 2 ** r;
    for (let m = 1; m <= count; m++) {
      matches.push({
        bracket_side: "W",
        round_no: r,
        match_no: m,
        a_entry_id: null,
        b_entry_id: null,
        next_round_no: r < totalRounds ? r + 1 : null,
        next_match_no: r < totalRounds ? Math.ceil(m / 2) : null,
        next_bracket_side: r < totalRounds ? "W" : null,
        loser_next_round_no: null,
        loser_next_match_no: null,
        loser_next_bracket_side: null,
        best_of: 1,
      });
    }
  }

  return matches;
}

/** Next power of two >= n (minimum 2). */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return Math.max(2, p);
}

/**
 * Standard bracket seed order (aka "snake"): for size 8, returns
 * [1,8,5,4,3,6,7,2] so that slot pairs are (1v8), (5v4), (3v6), (7v2) in
 * round 1, and 1/2 only meet in the final.
 */
export function seedOrder(size: number): number[] {
  let rounds: number[] = [1, 2];
  while (rounds.length < size) {
    const next: number[] = [];
    const pairSum = rounds.length * 2 + 1;
    for (const s of rounds) {
      next.push(s);
      next.push(pairSum - s);
    }
    rounds = next;
  }
  return rounds;
}

/**
 * Best-effort swap to avoid same-district pairings in round 1. Walks
 * adjacent slot pairs; for each conflict, find the nearest pair where a
 * swap breaks this conflict without creating a new one and swap.
 */
function spreadByDistrict(slots: (SeededEntry | null)[]): void {
  for (let i = 0; i < slots.length; i += 2) {
    const a = slots[i];
    const b = slots[i + 1];
    if (!a || !b) continue;
    const d = districtOf(a);
    if (!d || d !== districtOf(b)) continue;

    // Search for a pair (j, j+1) where swapping b with slots[j+1] clears
    // the conflict and doesn't create a new one.
    for (let j = 0; j < slots.length; j += 2) {
      if (j === i) continue;
      const c = slots[j];
      const e = slots[j + 1];
      if (!c || !e) continue;
      const dc = districtOf(c);
      const de = districtOf(e);
      // swap b <-> e
      const newI_b = de && districtOf(a) === de;
      const newJ_b = districtOf(c) === districtOf(b);
      if (!newI_b && !newJ_b) {
        slots[i + 1] = e;
        slots[j + 1] = b;
        break;
      }
    }
  }
}

function districtOf(e: SeededEntry): string | null {
  return (e.district ?? e.team ?? null) || null;
}

/**
 * Double-elimination bracket builder.
 *
 * Layout for a power-of-two bracket of size S = 2^k (k >= 1):
 *
 *   Winners' bracket (W): identical to {@link buildBracket} — k rounds with
 *   S/2, S/4, ..., 1 matches.
 *
 *   Losers' bracket (L): 2(k-1) rounds. For k=1 (S=2) the losers' bracket is
 *   empty. Counts:
 *     L1            S/4 matches  ← pair losers of W1
 *     L2            S/4 matches  ← W(L1) vs losers of W2
 *     L3            S/8 matches  ← pair winners of L2
 *     L4            S/8 matches  ← W(L3) vs losers of W3
 *     ...
 *     L(2k-3)       1 match      ← pair winners of L(2k-4)
 *     L(2k-2)       1 match      ← W(L(2k-3)) vs loser of W(k)
 *   Total LB matches: S - 2.
 *
 *   Grand final (GF): 1 match, W bracket winner vs L bracket winner. We do
 *   NOT emit a "bracket-reset" 2nd grand final by default — most regional
 *   federations (and WAF national selections) play a single grand final.
 *
 * Drop routing — odd LB rounds:
 *   L1.m   = loser(W1.m) vs loser(W1.(S/2 + 1 - m))           [cross-half]
 *   L(2j+1).m = winner(L(2j).(2m-1)) vs winner(L(2j).(2m))    [pair adjacent]
 *
 * Drop routing — even LB rounds (j >= 1):
 *   L(2j).m = winner(L(2j-1).m) vs loser(W(j+1).(M+1-m))
 *   where M = number of matches in W(j+1) = S/2^(j+1).
 *   The "M+1-m" inversion on the WB-loser side keeps athletes who came
 *   through opposite WB halves apart for as long as possible.
 *
 * Entries with byes are represented as null slots in W1 (same as single-elim).
 * The match runner is responsible for auto-advancing byes; this builder only
 * lays out the shells and routing pointers.
 */
export function buildDoubleElim(entries: SeededEntry[]): PlannedMatch[] {
  const N = entries.length;
  if (N < 2) return [];

  // Degenerate: 2 entrants. A "true" double-elim with 2 athletes would be
  // best-of-3, which is a different structure (not bracket-shaped). Fall
  // back to single-elim — the format selector is allowed to over-promise
  // here without producing nonsense fixtures.
  if (N === 2) return buildBracket(entries);

  const size = nextPow2(N);
  const k = Math.log2(size);

  // Build the WB exactly the same way buildBracket does so seeding + the
  // district-spread heuristic stay consistent across formats.
  const wb = buildBracket(entries);

  // ---- Losers' bracket -----------------------------------------------------
  // Number of LB rounds (k=2 -> 2 rounds, k=3 -> 4 rounds, ...).
  const lbRounds = 2 * (k - 1);

  // matchCounts[r] = number of matches in LB round r (1-indexed).
  const matchCounts: number[] = [0];
  for (let r = 1; r <= lbRounds; r++) {
    // For odd r=2j-1, count = S / 2^(j+1). For even r=2j, count = S / 2^(j+1).
    // i.e. rounds (2j-1) and (2j) share the same count.
    const j = Math.ceil(r / 2);
    matchCounts.push(size / 2 ** (j + 1));
  }

  const lb: PlannedMatch[] = [];
  for (let r = 1; r <= lbRounds; r++) {
    const count = matchCounts[r];
    for (let m = 1; m <= count; m++) {
      // Where does the winner of this LB match go?
      let nextR: number | null;
      let nextM: number | null;
      let nextSide: BracketSide | null;
      if (r < lbRounds) {
        nextR = r + 1;
        nextSide = "L";
        if ((r + 1) % 2 === 1) {
          // Next round is odd (minor): pair adjacent winners.
          nextM = Math.ceil(m / 2);
        } else {
          // Next round is even (major): same slot index — winner sits in
          // position m and waits for the WB-loser drop.
          nextM = m;
        }
      } else {
        // Final LB match feeds the grand final.
        nextR = 1;
        nextM = 1;
        nextSide = "GF";
      }

      lb.push({
        bracket_side: "L",
        round_no: r,
        match_no: m,
        a_entry_id: null,
        b_entry_id: null,
        next_round_no: nextR,
        next_match_no: nextM,
        next_bracket_side: nextSide,
        loser_next_round_no: null,
        loser_next_match_no: null,
        loser_next_bracket_side: null,
        best_of: 1,
      });
    }
  }

  // ---- WB → LB drop routing -----------------------------------------------
  // Mutate `wb` to attach loser_next_* pointers.
  // W1 losers drop to L1 with cross-half pairing.
  const w1Count = size / 2;
  for (const m of wb.filter((x) => x.round_no === 1)) {
    // L1 has w1Count/2 matches. W1.k pairs with W1.(w1Count + 1 - k).
    const lbMatchNo = Math.min(m.match_no, w1Count + 1 - m.match_no);
    m.loser_next_round_no = 1;
    m.loser_next_match_no = lbMatchNo;
    m.loser_next_bracket_side = "L";
  }

  // W(j+1) losers (for j >= 1) drop to L(2j) with reversed-order pairing.
  for (let wbR = 2; wbR <= k; wbR++) {
    const j = wbR - 1;
    const lbR = 2 * j;
    const M = size / 2 ** wbR; // matches in this WB round
    for (const m of wb.filter((x) => x.round_no === wbR)) {
      m.loser_next_round_no = lbR;
      m.loser_next_match_no = M + 1 - m.match_no;
      m.loser_next_bracket_side = "L";
    }
  }

  // The WB final's winner now goes to the grand final, not into a higher
  // WB round (it was previously marked next=null).
  const wbFinal = wb.find((x) => x.round_no === k && x.match_no === 1)!;
  wbFinal.next_round_no = 1;
  wbFinal.next_match_no = 1;
  wbFinal.next_bracket_side = "GF";

  // ---- Grand final --------------------------------------------------------
  // Best-of-3 by default. The LB finalist starts the GF with one tournament
  // loss already, so a single-game GF would mean both finalists need a
  // different number of losses to be crowned — best-of-3 is the cleanest
  // way to give the LB athlete a fair championship chance without emitting
  // a separate "bracket-reset" 2nd grand final row.
  const gf: PlannedMatch = {
    bracket_side: "GF",
    round_no: 1,
    match_no: 1,
    a_entry_id: null, // filled by WB final winner
    b_entry_id: null, // filled by LB final winner
    next_round_no: null,
    next_match_no: null,
    next_bracket_side: null,
    loser_next_round_no: null,
    loser_next_match_no: null,
    loser_next_bracket_side: null,
    best_of: 3,
  };

  return [...wb, ...lb, gf];
}

export type BracketFormat = "single_elim" | "double_elim";

/**
 * Format-aware dispatcher. Anything not in the supported list falls back to
 * single-elim (round-robin / supermatch formats live in different generators
 * and aren't covered here).
 */
export function buildFixtures(
  entries: SeededEntry[],
  format: BracketFormat | string
): PlannedMatch[] {
  if (format === "double_elim") return buildDoubleElim(entries);
  return buildBracket(entries);
}

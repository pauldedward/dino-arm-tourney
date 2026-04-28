import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupRowsByDistrict,
  type GroupableRow,
} from "./group-by-district";

function row(
  id: string,
  district: string | null,
  status: "pending" | "verified" | "rejected" | null,
  amount: number | null = null,
  team: string | null = null
): GroupableRow {
  return {
    id,
    district,
    team,
    payment: status ? { id: `p-${id}`, status, amount_inr: amount } : null,
  };
}

describe("groupRowsByDistrict", () => {
  it("returns an empty list when given no rows", () => {
    assert.deepEqual(groupRowsByDistrict([]), []);
  });

  it("buckets rows by district", () => {
    const groups = groupRowsByDistrict([
      row("a", "Trichy", "verified", 200),
      row("b", "Trichy", "pending", 200),
      row("c", "Madurai", "verified", 200),
    ]);
    assert.equal(groups.length, 2);
    const trichy = groups.find((g) => g.key === "Trichy")!;
    const madurai = groups.find((g) => g.key === "Madurai")!;
    assert.equal(trichy.rows.length, 2);
    assert.equal(madurai.rows.length, 1);
  });

  it("sums verified amounts into collectedInr and pending into pendingInr", () => {
    const [g] = groupRowsByDistrict([
      row("a", "Trichy", "verified", 200),
      row("b", "Trichy", "verified", 300),
      row("c", "Trichy", "pending", 150),
      row("d", "Trichy", "rejected", 999), // ignored
    ]);
    assert.equal(g.collectedInr, 500);
    assert.equal(g.pendingInr, 150);
  });

  it("collects pending payment objects so bulk-collect can fire one call", () => {
    const [g] = groupRowsByDistrict([
      row("a", "Trichy", "pending", 200),
      row("b", "Trichy", "pending", 300),
      row("c", "Trichy", "verified", 999),
    ]);
    assert.equal(g.collectablePayments.length, 2);
    assert.deepEqual(
      g.collectablePayments.map((p) => p.id).sort(),
      ["p-a", "p-b"]
    );
  });

  it("treats null amounts on pending payments as 0 and skips collectable", () => {
    // A pending row with no fee owed is nothing to collect — the bulk
    // popover would just show "Collect ₹0" which is meaningless.
    const [g] = groupRowsByDistrict([
      row("a", "Trichy", "pending", null),
      row("b", "Trichy", "pending", 100),
    ]);
    assert.equal(g.pendingInr, 100);
    assert.equal(g.collectablePayments.length, 1);
    assert.equal(g.collectablePayments[0].id, "p-b");
  });

  it("falls back to team label when district is missing", () => {
    const [g] = groupRowsByDistrict([
      row("a", null, "pending", 100, "Hercules Gym"),
    ]);
    assert.equal(g.key, "Hercules Gym");
    assert.equal(g.label, "Team · Hercules Gym");
  });

  it("buckets rows with neither district nor team under '—'", () => {
    const [g] = groupRowsByDistrict([
      row("a", null, "pending", 100),
      row("b", "", "verified", 200),
    ]);
    assert.equal(g.key, "—");
    assert.equal(g.rows.length, 2);
    assert.equal(g.collectedInr, 200);
    assert.equal(g.pendingInr, 100);
  });

  it("handles rows with no payment row at all", () => {
    const [g] = groupRowsByDistrict([row("a", "Trichy", null)]);
    assert.equal(g.collectedInr, 0);
    assert.equal(g.pendingInr, 0);
    assert.equal(g.collectablePayments.length, 0);
  });

  it("counts partial collections in BOTH collectedInr and pendingInr", () => {
    // ₹500 fee, ₹200 collected so far → 200 to till, 300 still owed.
    const [g] = groupRowsByDistrict([
      {
        id: "a",
        district: "Trichy",
        team: null,
        payment: {
          id: "p-a",
          status: "pending",
          amount_inr: 500,
          collected_inr: 200,
          remaining_inr: 300,
        },
      },
    ]);
    assert.equal(g.collectedInr, 200);
    assert.equal(g.pendingInr, 300);
    assert.equal(g.collectablePayments.length, 1);
  });

  it("excludes a fully-paid (status=pending but covered) row from collectablePayments", () => {
    // Edge case: payment_collections sum >= amount_inr but the
    // payments.status flag hasn't been mirrored yet (race / write split).
    // The group helper should still treat the remainder as 0 and not
    // offer "Collect ₹0" on the bulk button.
    const [g] = groupRowsByDistrict([
      {
        id: "a",
        district: "Trichy",
        team: null,
        payment: {
          id: "p-a",
          status: "pending",
          amount_inr: 500,
          collected_inr: 500,
          remaining_inr: 0,
        },
      },
    ]);
    assert.equal(g.collectedInr, 500);
    assert.equal(g.pendingInr, 0);
    assert.equal(g.collectablePayments.length, 0);
  });

  it("returns groups sorted by label", () => {
    const groups = groupRowsByDistrict([
      row("a", "Madurai", "pending", 100),
      row("b", "Chennai", "pending", 100),
      row("c", "Trichy", "pending", 100),
    ]);
    assert.deepEqual(
      groups.map((g) => g.label),
      ["Chennai", "Madurai", "Trichy"]
    );
  });
});

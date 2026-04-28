import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocatePool } from "./allocate-pool";

describe("allocatePool", () => {
  const pmts = (...amounts: number[]) =>
    amounts.map((a, i) => ({ id: `p${i + 1}`, remaining_inr: a }));

  it("covers everyone fully when pool >= total", () => {
    const r = allocatePool(2000, pmts(500, 500, 500));
    assert.equal(r.allocations.length, 3);
    assert.deepEqual(r.fully_ids, ["p1", "p2", "p3"]);
    assert.equal(r.leftover_inr, 500);
    assert.equal(r.untouched_ids.length, 0);
    assert.equal(r.partial_ids.length, 0);
  });

  it("exhausts pool oldest-first with one partial at the boundary", () => {
    const r = allocatePool(800, pmts(500, 500, 500));
    assert.deepEqual(
      r.allocations,
      [
        { id: "p1", amount_inr: 500, fully_covered: true },
        { id: "p2", amount_inr: 300, fully_covered: false },
      ]
    );
    assert.deepEqual(r.fully_ids, ["p1"]);
    assert.deepEqual(r.partial_ids, ["p2"]);
    assert.deepEqual(r.untouched_ids, ["p3"]);
    assert.equal(r.leftover_inr, 0);
  });

  it("skips already-paid (remaining=0) rows silently", () => {
    const r = allocatePool(500, pmts(0, 500, 500));
    assert.deepEqual(r.fully_ids, ["p2"]);
    assert.deepEqual(r.untouched_ids, ["p3"]);
    assert.equal(r.leftover_inr, 0);
  });

  it("handles empty pool", () => {
    const r = allocatePool(0, pmts(500, 500));
    assert.equal(r.allocations.length, 0);
    assert.deepEqual(r.untouched_ids, ["p1", "p2"]);
    assert.equal(r.leftover_inr, 0);
  });

  it("handles empty payments list", () => {
    const r = allocatePool(500, []);
    assert.equal(r.allocations.length, 0);
    assert.equal(r.leftover_inr, 500);
  });

  it("floors fractional input", () => {
    const r = allocatePool(199.9, pmts(100, 100));
    assert.deepEqual(
      r.allocations,
      [
        { id: "p1", amount_inr: 100, fully_covered: true },
        { id: "p2", amount_inr: 99, fully_covered: false },
      ]
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planCollection, summarisePayment } from "./collections";

describe("summarisePayment", () => {
  it("treats a brand-new payment with no collections as pending", () => {
    const s = summarisePayment(500, []);
    assert.equal(s.collected_inr, 0);
    assert.equal(s.remaining_inr, 500);
    assert.equal(s.fully_collected, false);
    assert.equal(s.derived_status, "pending");
  });

  it("sums active collections and ignores reversed ones", () => {
    const s = summarisePayment(500, [
      { amount_inr: 200, reversed_at: null },
      { amount_inr: 100, reversed_at: "2026-04-27T10:00:00Z" }, // reversed
      { amount_inr: 150, reversed_at: null },
    ]);
    assert.equal(s.collected_inr, 350);
    assert.equal(s.remaining_inr, 150);
    assert.equal(s.fully_collected, false);
    assert.equal(s.derived_status, "pending");
  });

  it("flips to verified once collected >= total", () => {
    const s = summarisePayment(500, [
      { amount_inr: 200, reversed_at: null },
      { amount_inr: 300, reversed_at: null },
    ]);
    assert.equal(s.fully_collected, true);
    assert.equal(s.derived_status, "verified");
    assert.equal(s.remaining_inr, 0);
  });

  it("clamps remaining at zero on overpayment", () => {
    const s = summarisePayment(500, [{ amount_inr: 700, reversed_at: null }]);
    assert.equal(s.remaining_inr, 0);
    assert.equal(s.fully_collected, true);
  });

  it("splits received vs waived by collection method", () => {
    const s = summarisePayment(500, [
      { amount_inr: 200, method: "cash", reversed_at: null },
      { amount_inr: 100, method: "manual_upi", reversed_at: null },
      { amount_inr: 200, method: "waiver", reversed_at: null },
    ]);
    assert.equal(s.collected_inr, 500);
    assert.equal(s.received_inr, 300);
    assert.equal(s.waived_inr, 200);
    assert.equal(s.remaining_inr, 0);
    assert.equal(s.fully_collected, true);
  });

  it("a fully waived payment has received = 0 but is still verified", () => {
    const s = summarisePayment(500, [
      { amount_inr: 500, method: "waiver", reversed_at: null },
    ]);
    assert.equal(s.received_inr, 0);
    assert.equal(s.waived_inr, 500);
    assert.equal(s.derived_status, "verified");
  });

  it("ignores reversed waivers", () => {
    const s = summarisePayment(500, [
      { amount_inr: 200, method: "cash", reversed_at: null },
      { amount_inr: 300, method: "waiver", reversed_at: "2026-04-29T10:00:00Z" },
    ]);
    assert.equal(s.received_inr, 200);
    assert.equal(s.waived_inr, 0);
    assert.equal(s.remaining_inr, 300);
  });

  it("treats collections without an explicit method as received (legacy)", () => {
    const s = summarisePayment(500, [
      { amount_inr: 500, reversed_at: null },
    ]);
    assert.equal(s.received_inr, 500);
    assert.equal(s.waived_inr, 0);
  });
});

describe("planCollection", () => {
  const fresh = summarisePayment(500, []);

  it("returns a single cash row for a partial collection", () => {
    const plan = planCollection(fresh, {
      method: "cash",
      amount_inr: 200,
      waive_remainder: false,
      reference: "receipt #18",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.rows, [
      { amount_inr: 200, method: "cash", reference: "receipt #18" },
    ]);
  });

  it("clamps amount to remaining when operator over-types", () => {
    const partial = summarisePayment(500, [
      { amount_inr: 300, reversed_at: null },
    ]);
    const plan = planCollection(partial, {
      method: "cash",
      amount_inr: 400, // operator typed too much; only ₹200 left
      waive_remainder: false,
      reference: null,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.rows[0].amount_inr, 200);
  });

  it("emits TWO rows when collecting cash AND waiving remainder", () => {
    const plan = planCollection(fresh, {
      method: "cash",
      amount_inr: 200,
      waive_remainder: true,
      reference: null,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.rows.length, 2);
    assert.equal(plan.rows[0].method, "cash");
    assert.equal(plan.rows[0].amount_inr, 200);
    assert.equal(plan.rows[1].method, "waiver");
    assert.equal(plan.rows[1].amount_inr, 300);
  });

  it("waiver method always covers the full remainder", () => {
    const plan = planCollection(fresh, {
      method: "waiver",
      amount_inr: 0,
      waive_remainder: false,
      reference: "concession",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].method, "waiver");
    assert.equal(plan.rows[0].amount_inr, 500);
  });

  it("rejects zero-amount cash without waive flag", () => {
    const plan = planCollection(fresh, {
      method: "cash",
      amount_inr: 0,
      waive_remainder: false,
      reference: null,
    });
    assert.equal(plan.ok, false);
  });

  it("rejects collection on already-paid payment", () => {
    const done = summarisePayment(500, [
      { amount_inr: 500, reversed_at: null },
    ]);
    const plan = planCollection(done, {
      method: "cash",
      amount_inr: 100,
      waive_remainder: false,
      reference: null,
    });
    assert.equal(plan.ok, false);
  });

  it("waive_remainder alone (₹0 cash + waive) is valid", () => {
    const plan = planCollection(fresh, {
      method: "cash",
      amount_inr: 0,
      waive_remainder: true,
      reference: null,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].method, "waiver");
    assert.equal(plan.rows[0].amount_inr, 500);
  });
});

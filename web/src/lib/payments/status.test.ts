import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPaid,
  isWeighed,
  isWithdrawn,
  isDisqualified,
  isCompeting,
  paymentDisplay,
} from "./status";

describe("isWithdrawn", () => {
  it("true when lifecycle_status is withdrawn", () => {
    assert.equal(isWithdrawn("withdrawn"), true);
  });
  it("falls back to legacy status when lifecycle is missing", () => {
    assert.equal(isWithdrawn(null, "withdrawn"), true);
    assert.equal(isWithdrawn(undefined, "withdrawn"), true);
  });
  it("ignores legacy when lifecycle is set explicitly", () => {
    assert.equal(isWithdrawn("active", "withdrawn"), false);
  });
  it("false for active", () => {
    assert.equal(isWithdrawn("active"), false);
    assert.equal(isWithdrawn(null, "pending"), false);
  });
});

describe("isDisqualified", () => {
  it("true when discipline_status is disqualified", () => {
    assert.equal(isDisqualified("disqualified"), true);
  });
  it("falls back to legacy status", () => {
    assert.equal(isDisqualified(null, "disqualified"), true);
  });
  it("ignores legacy when discipline is set", () => {
    assert.equal(isDisqualified("clear", "disqualified"), false);
  });
});

describe("isCompeting", () => {
  it("true for active+clear", () => {
    assert.equal(
      isCompeting({ lifecycleStatus: "active", disciplineStatus: "clear" }),
      true,
    );
  });
  it("false when withdrawn", () => {
    assert.equal(
      isCompeting({ lifecycleStatus: "withdrawn", disciplineStatus: "clear" }),
      false,
    );
  });
  it("false when disqualified", () => {
    assert.equal(
      isCompeting({
        lifecycleStatus: "active",
        disciplineStatus: "disqualified",
      }),
      false,
    );
  });
});

describe("isPaid", () => {
  it("true when payments has verified row", () => {
    assert.equal(isPaid("pending", [{ status: "verified" }]), true);
  });
  it("true when derivedPaymentStatus is verified", () => {
    assert.equal(
      isPaid("pending", [], { derivedPaymentStatus: "verified" }),
      true,
    );
  });
  it("false when only pending/rejected payments exist", () => {
    assert.equal(isPaid("pending", [{ status: "pending" }]), false);
    assert.equal(isPaid("pending", [{ status: "rejected" }]), false);
  });
  it("false when no payments and no derived", () => {
    assert.equal(isPaid("pending", []), false);
  });
  it("false when withdrawn even with verified payment", () => {
    assert.equal(
      isPaid("pending", [{ status: "verified" }], {
        lifecycleStatus: "withdrawn",
      }),
      false,
    );
    // Legacy fallback path.
    assert.equal(isPaid("withdrawn", [{ status: "verified" }]), false);
  });
  it("false when disqualified", () => {
    assert.equal(
      isPaid("pending", [{ status: "verified" }], {
        disciplineStatus: "disqualified",
      }),
      false,
    );
  });
  it("treats null payment list as empty", () => {
    assert.equal(isPaid("pending", null), false);
    assert.equal(isPaid("pending", undefined), false);
  });
});

describe("isWeighed", () => {
  it("uses weigh_ins presence as source of truth", () => {
    assert.equal(isWeighed("pending", [{ id: "w1" }]), true);
  });
  it("checkin_status dominates weigh_ins when both present", () => {
    assert.equal(isWeighed("pending", [{ id: "w1" }], "not_arrived"), false);
    assert.equal(isWeighed("pending", [], "weighed_in"), true);
    assert.equal(isWeighed("pending", null, "no_show"), false);
  });
  it("false when no signal at all", () => {
    assert.equal(isWeighed("pending", []), false);
  });
});

describe("paymentDisplay", () => {
  it("verified beats everything", () => {
    const d = paymentDisplay({ status: "verified", utr: null });
    assert.equal(d.label, "verified");
    assert.equal(d.tone, "ok");
  });
  it("rejected shows rejected", () => {
    const d = paymentDisplay({ status: "rejected", utr: "X" });
    assert.equal(d.label, "rejected");
    assert.equal(d.tone, "bad");
  });
  it("pending with UTR is review", () => {
    const d = paymentDisplay({ status: "pending", utr: "UTR123" });
    assert.equal(d.label, "review");
    assert.equal(d.tone, "warn");
  });
  it("pending without UTR is pending", () => {
    const d = paymentDisplay({ status: "pending", utr: null });
    assert.equal(d.label, "pending");
    assert.equal(d.tone, "muted");
  });
  it("null payment is dash", () => {
    const d = paymentDisplay(null);
    assert.equal(d.label, "—");
    assert.equal(d.tone, "muted");
  });
});

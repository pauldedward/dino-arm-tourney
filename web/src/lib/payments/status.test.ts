import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPaid, isWeighed, paymentDisplay } from "./status";

describe("isPaid", () => {
  it("returns true when any payment row is verified", () => {
    assert.equal(isPaid("pending", [{ status: "verified" }]), true);
  });
  it("returns true when registration.status is paid (legacy)", () => {
    // Legacy data: a registration may have been flipped to 'paid' before
    // payments rows existed. Treat as paid until backfill migration.
    assert.equal(isPaid("paid", []), true);
  });
  it("returns true when registration.status is weighed_in (legacy)", () => {
    assert.equal(isPaid("weighed_in", []), true);
  });
  it("returns false when only pending/rejected payments exist", () => {
    assert.equal(isPaid("pending", [{ status: "pending" }]), false);
    assert.equal(isPaid("pending", [{ status: "rejected" }]), false);
  });
  it("returns false when no payments and registration is pending", () => {
    assert.equal(isPaid("pending", []), false);
  });
  it("returns false when registration is withdrawn even if a stale payment is verified", () => {
    // Withdrawn means the athlete is out — refund handled separately.
    // Operator dashboards should not show them as paid participants.
    assert.equal(isPaid("withdrawn", [{ status: "verified" }]), false);
  });
  it("treats null/undefined payment list as empty", () => {
    assert.equal(isPaid("pending", null), false);
    assert.equal(isPaid("pending", undefined), false);
  });
});

describe("isWeighed", () => {
  it("uses weigh_ins presence as source of truth", () => {
    assert.equal(isWeighed("pending", [{ id: "w1" }]), true);
  });
  it("falls back to legacy registration.status === weighed_in", () => {
    assert.equal(isWeighed("weighed_in", []), true);
    assert.equal(isWeighed("weighed_in", null), true);
  });
  it("returns false when no weigh-in row and status is paid", () => {
    assert.equal(isWeighed("paid", []), false);
  });
  it("prefers checkin_status when provided", () => {
    // checkin_status is the post-0029 source of truth. It must dominate
    // the legacy registrations.status mirror so a stale/wrong status
    // value can't keep showing the athlete as weighed-in.
    assert.equal(isWeighed("weighed_in", [], "not_arrived"), false);
    assert.equal(isWeighed("pending", [], "weighed_in"), true);
    assert.equal(isWeighed("pending", null, "no_show"), false);
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

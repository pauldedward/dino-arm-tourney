import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFixtureEligible } from "./eligibility";

describe("isFixtureEligible", () => {
  it("includes athletes whose legacy registrations.status is paid", () => {
    assert.equal(
      isFixtureEligible({
        regStatus: "paid",
        derivedPaymentStatus: null,
        checkinStatus: "not_arrived",
      }),
      true,
    );
  });

  it("includes athletes whose legacy registrations.status is weighed_in", () => {
    assert.equal(
      isFixtureEligible({
        regStatus: "weighed_in",
        derivedPaymentStatus: null,
        checkinStatus: "not_arrived",
      }),
      true,
    );
  });

  it("includes athletes who completed payment via installments (payment_summary verified)", () => {
    // The case the legacy filter MISSED: collections lifted the
    // payment to verified, but the registrations.status mirror was
    // never flipped because the trigger that does that only fires on
    // direct payment writes, not on payment_collections inserts.
    assert.equal(
      isFixtureEligible({
        regStatus: "pending",
        derivedPaymentStatus: "verified",
        checkinStatus: "not_arrived",
      }),
      true,
    );
  });

  it("includes athletes who already weighed in (checkin_status)", () => {
    assert.equal(
      isFixtureEligible({
        regStatus: "pending",
        derivedPaymentStatus: null,
        checkinStatus: "weighed_in",
      }),
      true,
    );
  });

  it("excludes pending unpaid not-arrived athletes", () => {
    assert.equal(
      isFixtureEligible({
        regStatus: "pending",
        derivedPaymentStatus: "pending",
        checkinStatus: "not_arrived",
      }),
      false,
    );
  });

  it("excludes withdrawn athletes even with a stale verified payment", () => {
    assert.equal(
      isFixtureEligible({
        regStatus: "withdrawn",
        derivedPaymentStatus: "verified",
        checkinStatus: "not_arrived",
      }),
      false,
    );
  });

  it("excludes disqualified athletes", () => {
    assert.equal(
      isFixtureEligible({
        regStatus: "disqualified",
        derivedPaymentStatus: "verified",
        checkinStatus: "weighed_in",
      }),
      false,
    );
  });

  it("excludes rejected payment with no other signal", () => {
    assert.equal(
      isFixtureEligible({
        regStatus: "pending",
        derivedPaymentStatus: "rejected",
        checkinStatus: "not_arrived",
      }),
      false,
    );
  });
});

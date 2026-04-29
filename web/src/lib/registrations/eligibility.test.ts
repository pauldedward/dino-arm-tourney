import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFixtureEligible } from "./eligibility";

describe("isFixtureEligible", () => {
  it("includes athletes whose payment is verified (derivedPaymentStatus)", () => {
    assert.equal(
      isFixtureEligible({
        lifecycleStatus: "active",
        disciplineStatus: "clear",
        derivedPaymentStatus: "verified",
        checkinStatus: "not_arrived",
      }),
      true,
    );
  });

  it("includes athletes who already weighed in (checkin_status)", () => {
    assert.equal(
      isFixtureEligible({
        lifecycleStatus: "active",
        disciplineStatus: "clear",
        derivedPaymentStatus: "pending",
        checkinStatus: "weighed_in",
      }),
      true,
    );
  });

  it("excludes pending unpaid not-arrived athletes", () => {
    assert.equal(
      isFixtureEligible({
        lifecycleStatus: "active",
        disciplineStatus: "clear",
        derivedPaymentStatus: "pending",
        checkinStatus: "not_arrived",
      }),
      false,
    );
  });

  it("excludes withdrawn athletes even with verified payment", () => {
    assert.equal(
      isFixtureEligible({
        lifecycleStatus: "withdrawn",
        disciplineStatus: "clear",
        derivedPaymentStatus: "verified",
        checkinStatus: "not_arrived",
      }),
      false,
    );
  });

  it("excludes disqualified athletes", () => {
    assert.equal(
      isFixtureEligible({
        lifecycleStatus: "active",
        disciplineStatus: "disqualified",
        derivedPaymentStatus: "verified",
        checkinStatus: "weighed_in",
      }),
      false,
    );
  });

  it("excludes rejected payment with no other signal", () => {
    assert.equal(
      isFixtureEligible({
        lifecycleStatus: "active",
        disciplineStatus: "clear",
        derivedPaymentStatus: "rejected",
        checkinStatus: "not_arrived",
      }),
      false,
    );
  });

  it("falls back to legacy regStatus when lifecycle/discipline missing", () => {
    // Pre-0039 row: only the deprecated mirror is set.
    assert.equal(
      isFixtureEligible({
        regStatus: "withdrawn",
        derivedPaymentStatus: "verified",
        checkinStatus: "not_arrived",
      }),
      false,
    );
    assert.equal(
      isFixtureEligible({
        regStatus: "disqualified",
        derivedPaymentStatus: "verified",
        checkinStatus: "weighed_in",
      }),
      false,
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildNominalRows } from "./build-nominal";

describe("buildNominalRows", () => {
  const reg = {
    id: "r1",
    chest_no: 12,
    full_name: "Alice",
    division: "SENIOR",
    district: "Chennai",
    team: null,
    declared_weight_kg: 65,
    age_categories: ["SENIOR"],
    status: "pending",
    checkin_status: "not_arrived" as string,
  };

  it("marks paid when payment_summary derived_status is verified", () => {
    const rows = buildNominalRows(
      [reg],
      [{ registration_id: "r1", derived_status: "verified" }],
      [],
    );
    assert.equal(rows[0].paid, true);
    assert.equal(rows[0].weighed, false);
  });

  it("marks not paid when payment_summary is pending", () => {
    const rows = buildNominalRows(
      [reg],
      [{ registration_id: "r1", derived_status: "pending" }],
      [],
    );
    assert.equal(rows[0].paid, false);
  });

  it("marks weighed when checkin_status is weighed_in", () => {
    const rows = buildNominalRows(
      [{ ...reg, checkin_status: "weighed_in" }],
      [],
      [],
    );
    assert.equal(rows[0].weighed, true);
  });

  it("marks weighed when there is a weigh_ins row even if checkin_status lags", () => {
    const rows = buildNominalRows(
      [reg],
      [],
      [{ registration_id: "r1" }],
    );
    assert.equal(rows[0].weighed, true);
  });

  it("never marks withdrawn athletes as paid even if a stale payment is verified", () => {
    const rows = buildNominalRows(
      [{ ...reg, status: "withdrawn" }],
      [{ registration_id: "r1", derived_status: "verified" }],
      [],
    );
    assert.equal(rows[0].paid, false);
  });

  it("falls back to legacy registrations.status when payment_summary has no row", () => {
    // Pre-0028 backfill: a row may exist with status='paid' but no
    // payments row yet. Must still report paid so the operator's
    // exported sheet matches the on-screen registration list.
    const rows = buildNominalRows(
      [{ ...reg, status: "paid" }],
      [],
      [],
    );
    assert.equal(rows[0].paid, true);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildNominalRows } from "./build-nominal";

describe("buildNominalRows", () => {
  const reg = {
    id: "r1",
    chest_no: 12,
    full_name: "Alice",
    gender: "F",
    dob: "2000-01-01",
    mobile: "9999999999",
    division: "SENIOR",
    district: "Chennai",
    team: null,
    declared_weight_kg: 65,
    age_categories: ["SENIOR"],
    status: "pending",
    lifecycle_status: "active" as const,
    discipline_status: "clear" as const,
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
    // checkin_status is null here so weigh_ins[] becomes the source of truth.
    const rows = buildNominalRows(
      [{ ...reg, checkin_status: null }],
      [],
      [{ registration_id: "r1" }],
    );
    assert.equal(rows[0].weighed, true);
  });

  it("never marks withdrawn athletes as paid even if payment is verified", () => {
    const rows = buildNominalRows(
      [{ ...reg, lifecycle_status: "withdrawn" }],
      [{ registration_id: "r1", derived_status: "verified" }],
      [],
    );
    assert.equal(rows[0].paid, false);
  });

  it("never marks disqualified athletes as paid", () => {
    const rows = buildNominalRows(
      [{ ...reg, discipline_status: "disqualified" }],
      [{ registration_id: "r1", derived_status: "verified" }],
      [],
    );
    assert.equal(rows[0].paid, false);
  });

  it("derives display status from lifecycle/discipline fields, not raw status", () => {
    // Raw `status` column is the deprecated mirror — operators should see
    // "Active" / "Withdrawn" / "Disqualified" regardless of legacy values
    // like "pending" / "approved" still sitting in registrations.status.
    const active = buildNominalRows([reg], [], []);
    assert.equal(active[0].status, "Active");

    const withdrawn = buildNominalRows(
      [{ ...reg, lifecycle_status: "withdrawn" }],
      [],
      [],
    );
    assert.equal(withdrawn[0].status, "Withdrawn");

    const dq = buildNominalRows(
      [{ ...reg, discipline_status: "disqualified" }],
      [],
      [],
    );
    assert.equal(dq[0].status, "Disqualified");

    // Disqualified beats withdrawn in the display.
    const both = buildNominalRows(
      [
        {
          ...reg,
          lifecycle_status: "withdrawn",
          discipline_status: "disqualified",
        },
      ],
      [],
      [],
    );
    assert.equal(both[0].status, "Disqualified");
  });
});

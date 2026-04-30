import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollupByDistrict } from "./district-rollup";
import type { PaymentReportRow } from "@/lib/pdf/PaymentReportSheet";

function row(over: Partial<PaymentReportRow>): PaymentReportRow {
  return {
    chest_no: null,
    full_name: null,
    team_or_district: null,
    age_categories: "",
    weight_classes: [],
    total_inr: 0,
    paid_inr: 0,
    received_inr: 0,
    waived_inr: 0,
    due_inr: 0,
    paid_by: null,
    ...over,
  };
}

describe("rollupByDistrict", () => {
  it("groups rows by district and sums money columns", () => {
    const out = rollupByDistrict([
      row({ team_or_district: "Chennai", total_inr: 500, received_inr: 500 }),
      row({ team_or_district: "Chennai", total_inr: 500, received_inr: 200, due_inr: 300 }),
      row({ team_or_district: "Madurai", total_inr: 500, waived_inr: 500 }),
    ]);
    const chennai = out.find((d) => d.district === "Chennai")!;
    assert.equal(chennai.athletes_n, 2);
    assert.equal(chennai.total_billable, 1000);
    assert.equal(chennai.total_received, 700);
    assert.equal(chennai.total_due, 300);
    assert.equal(chennai.percent_collected, 70);
    const madurai = out.find((d) => d.district === "Madurai")!;
    assert.equal(madurai.total_effective, 0);
    assert.equal(madurai.percent_collected, 100);
  });

  it("falls back to a placeholder bucket when district is missing", () => {
    const out = rollupByDistrict([
      row({ team_or_district: null, total_inr: 100, received_inr: 100 }),
      row({ team_or_district: "  ", total_inr: 100 }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.district, "(no district)");
    assert.equal(out[0]!.athletes_n, 2);
  });

  it("sorts districts alphabetically", () => {
    const out = rollupByDistrict([
      row({ team_or_district: "Salem" }),
      row({ team_or_district: "Chennai" }),
      row({ team_or_district: "Madurai" }),
    ]);
    assert.deepEqual(
      out.map((d) => d.district),
      ["Chennai", "Madurai", "Salem"]
    );
  });

  it("Summary totals === Districts grand totals (no drift between sheets)", () => {
    // Mirror what loaders.ts builds: per-row total_inr already excludes
    // rejected registrations (they're billable_inr=0). The Summary card
    // and the Districts grand row both must agree on every column and
    // on the % collected formula.
    const rows = [
      row({ team_or_district: "Chennai", total_inr: 500, received_inr: 500, paid_inr: 500 }),
      row({ team_or_district: "Chennai", total_inr: 500, received_inr: 200, paid_inr: 200, due_inr: 300 }),
      row({ team_or_district: "Madurai", total_inr: 500, waived_inr: 500, paid_inr: 500 }),
      row({ team_or_district: "Salem", total_inr: 800, received_inr: 300, waived_inr: 200, paid_inr: 500, due_inr: 300 }),
      row({ team_or_district: null, total_inr: 0 }), // a rejected reg → billable 0
    ];
    const districts = rollupByDistrict(rows);

    // Summary math (mirrors loaders.ts exactly)
    const sum_billable = rows.reduce((s, r) => s + r.total_inr, 0);
    const sum_received = rows.reduce((s, r) => s + r.received_inr, 0);
    const sum_waived = rows.reduce((s, r) => s + r.waived_inr, 0);
    const sum_due = rows.reduce((s, r) => s + r.due_inr, 0);
    const sum_effective = Math.max(0, sum_billable - sum_waived);
    const summary_pct =
      sum_effective > 0
        ? Math.min(100, (sum_received / sum_effective) * 100)
        : 100;

    // Districts grand math (mirrors payment-report-xlsx.ts grand row)
    const g_billable = districts.reduce((s, d) => s + d.total_billable, 0);
    const g_received = districts.reduce((s, d) => s + d.total_received, 0);
    const g_waived = districts.reduce((s, d) => s + d.total_waived, 0);
    const g_due = districts.reduce((s, d) => s + d.total_due, 0);
    const g_effective = districts.reduce((s, d) => s + d.total_effective, 0);
    const grand_pct =
      g_effective > 0 ? Math.min(100, (g_received / g_effective) * 100) : 100;

    assert.equal(g_billable, sum_billable, "Total ₹ must match Summary Billable");
    assert.equal(g_received, sum_received, "Received ₹ must match");
    assert.equal(g_waived, sum_waived, "Waived ₹ must match");
    assert.equal(g_due, sum_due, "Due ₹ must match");
    assert.equal(g_effective, sum_effective, "Effective ₹ must match");
    assert.equal(grand_pct, summary_pct, "% Collected must match");
  });
});

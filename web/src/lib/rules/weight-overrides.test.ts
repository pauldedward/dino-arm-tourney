import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOverrideRows, setOverride } from "./weight-overrides";

describe("buildOverrideRows", () => {
  it("emits one row per resolved entry, marking competing_up correctly", () => {
    const rows = buildOverrideRows(
      {
        gender: "M",
        nonpara_classes: ["SENIOR"],
        nonpara_hands: ["B"],
        para_codes: ["U"],
        para_hand: "R",
        weight_overrides: [
          { scope: "nonpara", code: "M", hand: "R", bucket_code: "M-100" },
        ],
      },
      78
    );
    assert.equal(rows.length, 3); // M-R, M-L, U-R
    const mR = rows.find((r) => r.code === "M" && r.hand === "R")!;
    const mL = rows.find((r) => r.code === "M" && r.hand === "L")!;
    const u = rows.find((r) => r.code === "U")!;
    assert.equal(mR.selectedBucket.label, "−100 kg");
    assert.equal(mR.competingUp, true);
    assert.equal(mL.selectedBucket.label, "−80 kg");
    assert.equal(mL.competingUp, false);
    assert.equal(u.scope, "para");
  });

  it("returns [] for invalid weight", () => {
    const rows = buildOverrideRows(
      { gender: "M", nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null },
      0
    );
    assert.deepEqual(rows, []);
  });
});

describe("setOverride", () => {
  it("adds a fresh override when picking a heavier bucket", () => {
    const rows = buildOverrideRows(
      {
        gender: "M",
        nonpara_classes: ["SENIOR"],
        nonpara_hands: ["R"],
        para_codes: [],
        para_hand: null,
      },
      78
    );
    const out = setOverride([], rows[0], "M-100");
    assert.equal(out.length, 1);
    assert.equal(out[0].bucket_code, "M-100");
  });

  it("removes the override when reverting to auto bucket", () => {
    const rows = buildOverrideRows(
      {
        gender: "M",
        nonpara_classes: ["SENIOR"],
        nonpara_hands: ["R"],
        para_codes: [],
        para_hand: null,
        weight_overrides: [{ scope: "nonpara", code: "M", hand: "R", bucket_code: "M-100" }],
      },
      78
    );
    const out = setOverride(
      [{ scope: "nonpara", code: "M", hand: "R", bucket_code: "M-100" }],
      rows[0],
      rows[0].autoBucket.code
    );
    assert.deepEqual(out, []);
  });

  it("preserves other entries' overrides", () => {
    const rows = buildOverrideRows(
      {
        gender: "M",
        nonpara_classes: ["SENIOR"],
        nonpara_hands: ["B"],
        para_codes: [],
        para_hand: null,
      },
      78
    );
    const initial = [
      { scope: "nonpara" as const, code: "M", hand: "L" as const, bucket_code: "M-90" },
    ];
    const rRow = rows.find((r) => r.hand === "R")!;
    const out = setOverride(initial, rRow, "M-100");
    assert.equal(out.length, 2);
    assert.ok(out.find((o) => o.hand === "L" && o.bucket_code === "M-90"));
    assert.ok(out.find((o) => o.hand === "R" && o.bucket_code === "M-100"));
  });
});

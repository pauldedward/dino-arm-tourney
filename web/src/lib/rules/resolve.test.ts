import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEntries, allowedHeavierBuckets, type RegistrationLite } from "./resolve";
import { WAF_ABLE, WAF_PARA } from "./waf-2025";

const baseReg: RegistrationLite = {
  id: "r1",
  gender: "M",
  declared_weight_kg: 80,
  nonpara_classes: ["SENIOR"],
  nonpara_hands: ["R"],
  para_codes: [],
  para_hand: null,
};

describe("resolveEntries", () => {
  it("non-para single hand emits one entry", () => {
    const out = resolveEntries(baseReg, null);
    assert.equal(out.length, 1);
    assert.equal(out[0].division, "Men");
    assert.equal(out[0].hand, "R");
    assert.equal(out[0].age_band, "SENIOR");
    assert.equal(out[0].competing_up, false);
  });

  it("non-para hand=B fans out to R + L", () => {
    const out = resolveEntries({ ...baseReg, nonpara_hands: ["B"] }, null);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((e) => e.hand).sort(), ["L", "R"]);
  });

  it("para hand B expands to both R and L entries", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        nonpara_classes: [],
        nonpara_hands: null,
        para_codes: ["U"],
        para_hand: "B",
      },
      null
    );
    assert.equal(out.length, 2);
    const hands = out.map((e) => e.hand).sort();
    assert.deepEqual(hands, ["L", "R"]);
    for (const e of out) {
      assert.equal(e.division, "Para Men");
      assert.equal(e.age_band, "U");
    }
  });

  it("dual-track athlete produces entries in both Men and Para Men", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        nonpara_hands: ["R"],
        para_codes: ["U"],
        para_hand: "L",
      },
      null
    );
    const divs = out.map((e) => e.division).sort();
    assert.deepEqual(divs, ["Men", "Para Men"]);
  });

  it("weighed-in weight overrides declared", () => {
    const heavy = resolveEntries(
      { ...baseReg, declared_weight_kg: 70 },
      { measured_kg: 95 }
    );
    const light = resolveEntries(
      { ...baseReg, declared_weight_kg: 70 },
      null
    );
    assert.notEqual(heavy[0].weight_class, light[0].weight_class);
  });

  it("returns [] when weight is invalid", () => {
    const out = resolveEntries({ ...baseReg, declared_weight_kg: 0 }, null);
    assert.deepEqual(out, []);
  });

  it("multiple non-para classes produce one entry per class", () => {
    const out = resolveEntries(
      { ...baseReg, nonpara_classes: ["SENIOR", "MASTER"], nonpara_hands: ["R", "R"] },
      null
    );
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((e) => e.age_band).sort(), ["MASTER", "SENIOR"]);
  });

  it("per-class hand differs: junior L + senior R produces 2 entries with correct hands", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        nonpara_classes: ["JUNIOR 18", "SENIOR"],
        nonpara_hands: ["L", "R"],
      },
      null
    );
    assert.equal(out.length, 2);
    const junior = out.find((e) => e.age_band === "JUNIOR 18");
    const senior = out.find((e) => e.age_band === "SENIOR");
    assert.equal(junior?.hand, "L");
    assert.equal(senior?.hand, "R");
  });

  it("per-class hand with B on one class fans that class only", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        nonpara_classes: ["JUNIOR 18", "SENIOR"],
        nonpara_hands: ["B", "R"],
      },
      null
    );
    assert.equal(out.length, 3);
  });
});

describe("resolveEntries — weight_overrides", () => {
  it("override to a heavier bucket promotes the entry and sets competing_up", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        declared_weight_kg: 78,
        weight_overrides: [
          { scope: "nonpara", code: "M", hand: "R", bucket_code: "M-100" },
        ],
      },
      null
    );
    assert.equal(out[0].weight_class, "−100 kg");
    assert.equal(out[0].competing_up, true);
    assert.equal(out[0].category_code, "M-−100 kg-R");
  });

  it("override to a lighter bucket is silently ignored", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        declared_weight_kg: 95,
        weight_overrides: [
          { scope: "nonpara", code: "M", hand: "R", bucket_code: "M-80" },
        ],
      },
      null
    );
    assert.equal(out[0].weight_class, "−100 kg");
    assert.equal(out[0].competing_up, false);
  });

  it("per-hand override: R bumped, L stays auto", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        declared_weight_kg: 78,
        nonpara_hands: ["B"],
        weight_overrides: [
          { scope: "nonpara", code: "M", hand: "R", bucket_code: "M-100" },
        ],
      },
      null
    );
    const r = out.find((e) => e.hand === "R")!;
    const l = out.find((e) => e.hand === "L")!;
    assert.equal(r.weight_class, "−100 kg");
    assert.equal(r.competing_up, true);
    assert.equal(l.weight_class, "−80 kg");
    assert.equal(l.competing_up, false);
  });

  it("para override works (PIU U @ 65 bumped to U-90)", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        nonpara_classes: [],
        nonpara_hands: null,
        para_codes: ["U"],
        para_hand: "R",
        declared_weight_kg: 65,
        weight_overrides: [
          { scope: "para", code: "U", hand: "R", bucket_code: "U-90" },
        ],
      },
      null
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].weight_class, "−90 kg");
    assert.equal(out[0].competing_up, true);
  });

  it("override to open bucket is allowed", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        declared_weight_kg: 78,
        weight_overrides: [
          { scope: "nonpara", code: "M", hand: "R", bucket_code: "M-110+" },
        ],
      },
      null
    );
    assert.equal(out[0].weight_class, "+110 kg");
    assert.equal(out[0].competing_up, true);
  });

  it("override at the open bucket is a no-op", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        declared_weight_kg: 130,
        weight_overrides: [
          { scope: "nonpara", code: "M", hand: "R", bucket_code: "M-110+" },
        ],
      },
      null
    );
    assert.equal(out[0].weight_class, "+110 kg");
    assert.equal(out[0].competing_up, false);
  });

  it("'+1' sentinel (legacy backfill) bumps one bucket up", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        declared_weight_kg: 78,
        weight_overrides: [
          { scope: "nonpara", code: "M", hand: "R", bucket_code: "+1" },
        ],
      },
      null
    );
    assert.equal(out[0].weight_class, "−85 kg");
    assert.equal(out[0].competing_up, true);
  });

  it("override with mismatched code is ignored", () => {
    const out = resolveEntries(
      {
        ...baseReg,
        declared_weight_kg: 78,
        weight_overrides: [
          { scope: "nonpara", code: "Y", hand: "R", bucket_code: "Y-110" },
        ],
      },
      null
    );
    assert.equal(out[0].weight_class, "−80 kg");
    assert.equal(out[0].competing_up, false);
  });
});

describe("allowedHeavierBuckets", () => {
  it("returns auto bucket plus every heavier in the WAF grid", () => {
    const senior = WAF_ABLE.find((c) => c.code === "M")!;
    const out = allowedHeavierBuckets(senior, 78);
    assert.deepEqual(out.map((b) => b.label), [
      "−80 kg",
      "−85 kg",
      "−90 kg",
      "−100 kg",
      "−110 kg",
      "+110 kg",
    ]);
  });

  it("at the open bucket returns just the open bucket", () => {
    const senior = WAF_ABLE.find((c) => c.code === "M")!;
    const out = allowedHeavierBuckets(senior, 130);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, "+110 kg");
  });

  it("works for para categories", () => {
    const piu = WAF_PARA.find((c) => c.code === "U")!;
    const out = allowedHeavierBuckets(piu, 65);
    assert.deepEqual(out.map((b) => b.label), [
      "−70 kg",
      "−80 kg",
      "−90 kg",
      "+90 kg",
    ]);
  });
});

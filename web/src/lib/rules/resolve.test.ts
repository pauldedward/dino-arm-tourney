import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEntries, type RegistrationLite } from "./resolve";

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
  });

  it("non-para hand=B fans out to R + L", () => {
    const out = resolveEntries({ ...baseReg, nonpara_hands: ["B"] }, null);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((e) => e.hand).sort(), ["L", "R"]);
  });

  it("para single-arm: hand B picks R deterministically", () => {
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
    assert.equal(out.length, 1);
    assert.equal(out[0].hand, "R");
    assert.equal(out[0].division, "Para Men");
    assert.equal(out[0].age_band, "U");
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
    // JUNIOR 18 → R + L (2), SENIOR → R (1) = 3
    assert.equal(out.length, 3);
    const juniorHands = out
      .filter((e) => e.age_band === "JUNIOR 18")
      .map((e) => e.hand)
      .sort();
    assert.deepEqual(juniorHands, ["L", "R"]);
    const seniorHands = out
      .filter((e) => e.age_band === "SENIOR")
      .map((e) => e.hand);
    assert.deepEqual(seniorHands, ["R"]);
  });
});

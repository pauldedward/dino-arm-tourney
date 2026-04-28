import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateRegistration,
  eligibleNonParaClasses,
  eligibleParaCategories,
  deriveDivision,
} from "./registration-rules";

const REF_YEAR = 2026;
const EVENT_DATE = `${REF_YEAR}-12-31`;

describe("eligibleNonParaClasses", () => {
  it("16-year-old M -> Junior 18 only", () => {
    const r = eligibleNonParaClasses("M", 16);
    assert.deepEqual(r.map((c) => c.className), ["JUNIOR 18"]);
  });

  it("19-year-old F -> Youth 23 only (Senior is 23+)", () => {
    const r = eligibleNonParaClasses("F", 19);
    assert.deepEqual(r.map((c) => c.className), ["YOUTH 23"]);
  });

  it("66-year-old M -> Senior + Master + Grand Master + Senior Grand Master", () => {
    const r = eligibleNonParaClasses("M", 66);
    assert.deepEqual(r.map((c) => c.className), [
      "SENIOR",
      "MASTER",
      "GRAND MASTER",
      "SENIOR GRAND MASTER",
    ]);
  });

  it("each className appears once even though chart splits by gender", () => {
    const r = eligibleNonParaClasses("M", 50);
    const names = r.map((c) => c.className);
    assert.equal(new Set(names).size, names.length);
  });
});

describe("eligibleParaCategories", () => {
  it("filters by gender", () => {
    const m = eligibleParaCategories("M", 25);
    const f = eligibleParaCategories("F", 25);
    assert.ok(m.length > 0);
    assert.ok(f.length > 0);
    assert.ok(m.every((c) => c.gender === "M"));
    assert.ok(f.every((c) => c.gender === "F"));
  });
});

describe("validateRegistration", () => {
  const baseInput = {
    gender: "M" as const,
    dob: "2000-06-15", // age 26 in 2026
    declaredWeightKg: 80,
    nonparaClasses: ["SENIOR"],
    nonparaHands: { SENIOR: "R" as const },
    paraCodes: [],
    paraHand: null,
  };

  it("ok when single non-para track is filled", () => {
    const v = validateRegistration(baseInput, EVENT_DATE);
    assert.equal(v.ok, true);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.effectiveNonPara, ["SENIOR"]);
    assert.deepEqual(v.effectivePara, []);
  });

  it("rejects empty registration (no track selected)", () => {
    const v = validateRegistration(
      { ...baseInput, nonparaClasses: [], nonparaHands: {} }, EVENT_DATE);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("at least one")));
  });

  it("requires a hand for each chosen non-para class", () => {
    const v = validateRegistration(
      { ...baseInput, nonparaHands: {} }, EVENT_DATE);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("hand required for")));
    assert.ok(v.errors.some((e) => e.includes("SENIOR")));
  });

  it("allows different hands per non-para class (junior L + senior R)", () => {
    const v = validateRegistration(
      {
        ...baseInput,
        dob: "2010-06-15", // age 16 in 2026
        nonparaClasses: ["JUNIOR 18", "SENIOR"],
        nonparaHands: { "JUNIOR 18": "L", SENIOR: "R" },
        includeSenior: true,
      }, EVENT_DATE);
    assert.equal(v.ok, true);
    assert.deepEqual(v.effectiveNonPara, ["JUNIOR 18", "SENIOR"]);
    assert.equal(v.effectiveNonParaHands["JUNIOR 18"], "L");
    assert.equal(v.effectiveNonParaHands.SENIOR, "R");
  });

  it("flags the specific class missing a hand", () => {
    const v = validateRegistration(
      {
        ...baseInput,
        dob: "2010-06-15",
        nonparaClasses: ["JUNIOR 18", "SENIOR"],
        nonparaHands: { "JUNIOR 18": "R" }, // SENIOR missing
        includeSenior: true,
      }, EVENT_DATE);
    assert.equal(v.ok, false);
    assert.ok(
      v.errors.some((e) => e.includes("hand required for") && e.includes("SENIOR"))
    );
  });

  it("drops out-of-eligibility non-para classes", () => {
    // age 16 cannot be SENIOR without opt-in
    const v = validateRegistration(
      {
        ...baseInput,
        dob: "2010-06-15", // age 16 in 2026
        nonparaClasses: ["JUNIOR 18", "SENIOR"],
        includeSenior: false,
      }, EVENT_DATE);
    assert.deepEqual(v.effectiveNonPara, ["JUNIOR 18"]);
  });

  it("16yo can opt into Senior with includeSenior", () => {
    const v = validateRegistration(
      {
        ...baseInput,
        dob: "2010-06-15",
        nonparaClasses: ["JUNIOR 18", "SENIOR"],
        nonparaHands: { "JUNIOR 18": "R", SENIOR: "R" },
        includeSenior: true,
      }, EVENT_DATE);
    assert.equal(v.ok, true);
    assert.deepEqual(v.effectiveNonPara, ["JUNIOR 18", "SENIOR"]);
  });

  it("para-only registration is valid", () => {
    const v = validateRegistration(
      {
        ...baseInput,
        nonparaClasses: [],
        nonparaHands: {},
        paraCodes: ["U"],
        paraHand: "R",
      }, EVENT_DATE);
    assert.equal(v.ok, true);
    assert.deepEqual(v.effectivePara, ["U"]);
  });

  it("requires para hand when para codes picked", () => {
    const v = validateRegistration(
      {
        ...baseInput,
        nonparaClasses: [],
        nonparaHands: {},
        paraCodes: ["U"],
        paraHand: null,
      }, EVENT_DATE);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("para hand")));
  });

  it("dual-track (non-para + para) is rejected — must pick one", () => {
    const v = validateRegistration(
      {
        ...baseInput,
        paraCodes: ["U"],
        paraHand: "L",
      }, EVENT_DATE);
    assert.equal(v.ok, false);
    assert.ok(
      v.errors.some((e) => e.includes("either non-para or para")),
      `expected mutual-exclusion error, got: ${v.errors.join("; ")}`
    );
  });

  it("rejects more than one para class", () => {
    const v = validateRegistration(
      {
        ...baseInput,
        nonparaClasses: [],
        nonparaHands: {},
        paraCodes: ["U", "E"],
        paraHand: "R",
      }, EVENT_DATE);
    assert.equal(v.ok, false);
    assert.ok(
      v.errors.some((e) => e.includes("only one para class")),
      `expected single-para error, got: ${v.errors.join("; ")}`
    );
  });
});

describe("deriveDivision", () => {
  it("non-para male -> Men", () => {
    assert.equal(deriveDivision("M", true, false), "Men");
  });
  it("non-para female -> Women", () => {
    assert.equal(deriveDivision("F", true, false), "Women");
  });
  it("para-only male -> Para Men", () => {
    assert.equal(deriveDivision("M", false, true), "Para Men");
  });
  it("dual prefers able-bodied label", () => {
    assert.equal(deriveDivision("F", true, true), "Women");
  });
});

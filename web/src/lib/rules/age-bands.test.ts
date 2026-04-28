// Verifies the form's age-category logic across every WAF age band:
//   1. The athlete's PRIMARY class = oldest qualifying band (sorted by minAge desc).
//   2. SENIOR is the one universal opt-in for any non-Senior primary,
//      provided age >= 16 (WAF compete-up minimum).
//   3. Below 16, SENIOR cannot be opted in (validator drops it).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  eligibleNonParaClasses,
  validateRegistration,
  ageOnDec31,
} from "./registration-rules";

const REF_YEAR = 2026;
const EVENT_DATE = `${REF_YEAR}-12-31`;

/** Mirror of the form's primary-class derivation. */
function primaryClassName(gender: "M" | "F", age: number): string | null {
  const bands = [...eligibleNonParaClasses(gender, age)].sort(
    (a, b) => b.minAge - a.minAge
  );
  return bands[0]?.className ?? null;
}

/** Build a YYYY-MM-DD string for an athlete who turns `age` on 31 Dec REF_YEAR. */
function dobForAge(age: number): string {
  return `${REF_YEAR - age}-06-15`;
}

const cases: {
  label: string;
  age: number;
  gender: "M" | "F";
  expectPrimary: string;
}[] = [
  { label: "14 M -> SUB-JUNIOR 15",            age: 14, gender: "M", expectPrimary: "SUB-JUNIOR 15" },
  { label: "15 F -> SUB-JUNIOR 15",            age: 15, gender: "F", expectPrimary: "SUB-JUNIOR 15" },
  { label: "16 M -> JUNIOR 18",                age: 16, gender: "M", expectPrimary: "JUNIOR 18" },
  { label: "18 F -> JUNIOR 18",                age: 18, gender: "F", expectPrimary: "JUNIOR 18" },
  { label: "19 M -> YOUTH 23",                 age: 19, gender: "M", expectPrimary: "YOUTH 23" },
  { label: "22 F -> YOUTH 23",                 age: 22, gender: "F", expectPrimary: "YOUTH 23" },
  { label: "23 M -> SENIOR",                   age: 23, gender: "M", expectPrimary: "SENIOR" },
  { label: "30 M -> SENIOR",                   age: 30, gender: "M", expectPrimary: "SENIOR" },
  { label: "39 F -> SENIOR",                   age: 39, gender: "F", expectPrimary: "SENIOR" },
  { label: "40 M -> MASTER",                   age: 40, gender: "M", expectPrimary: "MASTER" },
  { label: "49 F -> MASTER",                   age: 49, gender: "F", expectPrimary: "MASTER" },
  { label: "50 M -> GRAND MASTER",             age: 50, gender: "M", expectPrimary: "GRAND MASTER" },
  { label: "55 F -> GRAND MASTER",             age: 55, gender: "F", expectPrimary: "GRAND MASTER" },
  { label: "60 M -> SENIOR GRAND MASTER",      age: 60, gender: "M", expectPrimary: "SENIOR GRAND MASTER" },
  { label: "65 M -> SENIOR GRAND MASTER",      age: 65, gender: "M", expectPrimary: "SENIOR GRAND MASTER" },
  { label: "70 M -> SUPER SENIOR GRAND MASTER",age: 70, gender: "M", expectPrimary: "SUPER SENIOR GRAND MASTER" },
];

describe("primary class derivation across all age bands", () => {
  for (const c of cases) {
    it(c.label, () => {
      assert.equal(primaryClassName(c.gender, c.age), c.expectPrimary);
    });
  }
});

describe("ageOnDec31 sanity for chosen DOBs", () => {
  for (const c of cases) {
    it(`${c.label} (DOB ${dobForAge(c.age)})`, () => {
      assert.equal(ageOnDec31(dobForAge(c.age), REF_YEAR), c.age);
    });
  }
});

describe("primary-only registration is valid for every age band", () => {
  for (const c of cases) {
    it(c.label, () => {
      const v = validateRegistration(
        {
          gender: c.gender,
          dob: dobForAge(c.age),
          declaredWeightKg: 80,
          nonparaClasses: [c.expectPrimary],
          nonparaHands: { [c.expectPrimary]: "R" },
          paraCodes: [],
          paraHand: null,
        }, EVENT_DATE);
      assert.equal(v.ok, true, v.errors.join("; "));
      assert.deepEqual(v.effectiveNonPara, [c.expectPrimary]);
      assert.equal(v.effectiveNonParaHands[c.expectPrimary], "R");
    });
  }
});

describe("Senior opt-in (universal add-on) for age >= 16, non-Senior primaries", () => {
  const optInCases = cases.filter(
    (c) => c.age >= 16 && c.expectPrimary !== "SENIOR"
  );

  for (const c of optInCases) {
    it(`${c.label}: primary + SENIOR opt-in`, () => {
      const v = validateRegistration(
        {
          gender: c.gender,
          dob: dobForAge(c.age),
          declaredWeightKg: 80,
          nonparaClasses: [c.expectPrimary, "SENIOR"],
          nonparaHands: { [c.expectPrimary]: "R", SENIOR: "L" },
          // SENIOR is 23+; ages 16-22 need the compete-up flag.
          includeSenior: c.age < 23,
          paraCodes: [],
          paraHand: null,
        }, EVENT_DATE);
      assert.equal(v.ok, true, v.errors.join("; "));
      assert.ok(
        v.effectiveNonPara.includes(c.expectPrimary),
        "primary missing from effective"
      );
      assert.ok(
        v.effectiveNonPara.includes("SENIOR"),
        "SENIOR opt-in dropped"
      );
      assert.equal(v.effectiveNonParaHands[c.expectPrimary], "R");
      assert.equal(v.effectiveNonParaHands.SENIOR, "L");
    });
  }
});

describe("under-16 cannot opt into Senior", () => {
  const u16 = cases.filter((c) => c.age < 16);

  for (const c of u16) {
    it(`${c.label}: SENIOR opt-in is dropped`, () => {
      const v = validateRegistration(
        {
          gender: c.gender,
          dob: dobForAge(c.age),
          declaredWeightKg: 50,
          nonparaClasses: [c.expectPrimary, "SENIOR"],
          nonparaHands: { [c.expectPrimary]: "R", SENIOR: "R" },
          includeSenior: true, // even with the flag, validator must refuse
          paraCodes: [],
          paraHand: null,
        }, EVENT_DATE);
      assert.deepEqual(v.effectiveNonPara, [c.expectPrimary]);
      assert.ok(!("SENIOR" in v.effectiveNonParaHands));
    });
  }
});

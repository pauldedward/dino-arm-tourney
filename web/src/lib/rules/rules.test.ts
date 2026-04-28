import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWeight,
  ageOnDec31,
  ageOnMatchDay,
  eligibleBands,
} from "./index";

describe("classifyWeight — Senior Men", () => {
  it("puts 62.0 kg into −65", () => {
    const c = classifyWeight(62.0, "Men", "senior");
    assert.equal(c?.code, "SM-65");
  });

  it("puts 80.0 kg into −80 (boundary inclusive)", () => {
    const c = classifyWeight(80.0, "Men", "senior");
    assert.equal(c?.code, "SM-80");
  });

  it("puts 80.01 kg into −85 (just over boundary)", () => {
    const c = classifyWeight(80.01, "Men", "senior");
    assert.equal(c?.code, "SM-85");
  });

  it("puts 145 kg into open class +110", () => {
    const c = classifyWeight(145, "Men", "senior");
    assert.equal(c?.code, "SM-OPN");
  });

  it("puts 54.0 kg into −55 (lightest)", () => {
    const c = classifyWeight(54.0, "Men", "senior");
    assert.equal(c?.code, "SM-55");
  });
});

describe("classifyWeight — Senior Women", () => {
  it("puts 48.0 kg into −50", () => {
    const c = classifyWeight(48.0, "Women", "senior");
    assert.equal(c?.code, "SW-50");
  });

  it("puts 82.0 kg into +80 open", () => {
    const c = classifyWeight(82.0, "Women", "senior");
    assert.equal(c?.code, "SW-OPN");
  });
});

describe("classifyWeight — Youth uses youth grid", () => {
  it("puts 62 kg youth man into YM-65, not SM-65", () => {
    const c = classifyWeight(62, "Men", "youth");
    assert.equal(c?.code, "YM-65");
  });
});

describe("classifyWeight — Masters fall back to senior grid", () => {
  it("puts a 75-year-old 82 kg man in SM-85 (senior classes are used)", () => {
    const c = classifyWeight(82, "Men", "master");
    assert.equal(c?.code, "SM-85");
  });
});

describe("classifyWeight — Para divisions return null here", () => {
  it("Para Men resolves to null (handled by para.ts)", () => {
    assert.equal(classifyWeight(75, "Para Men", "senior"), null);
  });
});

describe("ageOnDec31", () => {
  it("gives 21 for someone born 2005-04-15 in 2026", () => {
    assert.equal(ageOnDec31("2005-04-15", 2026), 21);
  });
  it("gives 13 for someone born 2013-12-01 in 2026", () => {
    assert.equal(ageOnDec31("2013-12-01", 2026), 13);
  });
});

describe("ageOnMatchDay", () => {
  it("birthday already passed before match day", () => {
    // born 2005-04-15, match day 2026-06-01 → already 21
    assert.equal(ageOnMatchDay("2005-04-15", "2026-06-01"), 21);
  });
  it("birthday not yet reached on match day", () => {
    // born 2005-08-20, match day 2026-06-01 → still 20
    assert.equal(ageOnMatchDay("2005-08-20", "2026-06-01"), 20);
  });
  it("birthday on match day counts as the new age", () => {
    assert.equal(ageOnMatchDay("2005-06-01", "2026-06-01"), 21);
  });
  it("accepts ISO timestamp from Postgres timestamptz", () => {
    assert.equal(
      ageOnMatchDay("2010-12-31", "2026-12-15T09:30:00+00:00"),
      15
    );
  });
  it("returns NaN for malformed dob", () => {
    assert.ok(Number.isNaN(ageOnMatchDay("not-a-date", "2026-06-01")));
  });
});

describe("eligibleBands", () => {
  it("age 15 → SubJunior only", () => {
    const codes = eligibleBands(15).map((b) => b.code);
    assert.deepEqual(codes, ["SubJunior"]);
  });
  it("age 22 → Youth + Senior (overlap zone)", () => {
    const codes = eligibleBands(22).map((b) => b.code);
    assert.deepEqual(codes, ["Youth", "Senior"]);
  });
  it("age 42 → Senior + Master", () => {
    const codes = eligibleBands(42).map((b) => b.code);
    assert.deepEqual(codes, ["Senior", "Master"]);
  });
  it("age 65 → Senior + Master + GrandMaster + SeniorGrandMaster", () => {
    const codes = eligibleBands(65).map((b) => b.code);
    assert.deepEqual(codes, [
      "Senior",
      "Master",
      "GrandMaster",
      "SeniorGrandMaster",
    ]);
  });
});

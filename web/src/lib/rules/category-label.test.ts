import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatCategoryCode,
  prettyNonparaClassName,
  prettyParaCode,
  formatCategoryListForDisplay,
} from "./category-label";

describe("formatCategoryCode", () => {
  it("renders youth bands without the embedded age number", () => {
    assert.equal(formatCategoryCode("Y-−80 kg-R"), "Youth Men · −80 kg · Right");
    assert.equal(formatCategoryCode("J-−70 kg-L"), "Junior Men · −70 kg · Left");
    assert.equal(formatCategoryCode("KW-−45 kg-R"), "Sub-Junior Women · −45 kg · Right");
  });
  it("keeps senior / master / para labels untouched", () => {
    assert.equal(formatCategoryCode("M-−80 kg-R"), "Senior Men · −80 kg · Right");
    assert.equal(formatCategoryCode("V-OPEN-L"), "Master Men · OPEN · Left");
    assert.equal(formatCategoryCode("U-OPEN-R"), "Para PIU Stand Men · OPEN · Right");
  });
  it("falls back to the raw code when it cannot be parsed", () => {
    assert.equal(formatCategoryCode("garbage"), "garbage");
  });
});

describe("prettyNonparaClassName", () => {
  it("drops the embedded age number from youth bands", () => {
    assert.equal(prettyNonparaClassName("JUNIOR 18"), "Junior");
    assert.equal(prettyNonparaClassName("Youth 23"), "Youth");
    assert.equal(prettyNonparaClassName("SUB-JUNIOR 15"), "Sub-Junior");
  });
  it("title-cases SCREAMING-SNAKE class names", () => {
    assert.equal(prettyNonparaClassName("SENIOR"), "Senior");
    assert.equal(prettyNonparaClassName("MASTER"), "Master");
  });
  it("returns empty for blank input", () => {
    assert.equal(prettyNonparaClassName(""), "");
    assert.equal(prettyNonparaClassName(null), "");
  });
});

describe("prettyParaCode", () => {
  it("resolves WAF para codes to readable labels", () => {
    assert.equal(prettyParaCode("U"), "Para PIU Stand Men");
    assert.equal(prettyParaCode("EW"), "Para VI Stand Women");
  });
  it("falls back to the raw code on unknown values", () => {
    assert.equal(prettyParaCode("XX9"), "XX9");
  });
});

describe("formatCategoryListForDisplay", () => {
  it("mixes non-para class names and para codes into one display string", () => {
    assert.equal(
      formatCategoryListForDisplay(["JUNIOR 18", "SENIOR", "U"]),
      "Junior, Senior, Para PIU Stand Men",
    );
  });
  it("de-duplicates and skips blanks", () => {
    assert.equal(
      formatCategoryListForDisplay(["SENIOR", "Senior", "", null, "SENIOR"]),
      "Senior",
    );
  });
});

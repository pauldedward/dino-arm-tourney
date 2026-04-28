import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classLabelsForCard,
  nonparaClassLabel,
  paraCodeLabel,
} from "./class-label";

describe("nonparaClassLabel", () => {
  test("matches the canonical classFull from waf-2025", () => {
    assert.equal(nonparaClassLabel("SENIOR"), "Senior");
    assert.equal(nonparaClassLabel("JUNIOR 18"), "Junior 18");
    assert.equal(nonparaClassLabel("YOUTH 23"), "Youth 23");
    assert.equal(nonparaClassLabel("SUB-JUNIOR 15"), "Sub-Junior 15");
    assert.equal(nonparaClassLabel("MASTER"), "Master");
    assert.equal(nonparaClassLabel("GRAND MASTER"), "Grand Master");
    assert.equal(
      nonparaClassLabel("SUPER SENIOR GRAND MASTER"),
      "Super Senior Grand Master",
    );
  });

  test("is case-insensitive and trims whitespace", () => {
    assert.equal(nonparaClassLabel("  senior "), "Senior");
    assert.equal(nonparaClassLabel("Junior 18"), "Junior 18");
  });

  test("falls back to the raw trimmed input when unknown", () => {
    assert.equal(nonparaClassLabel("Future-Class"), "Future-Class");
  });

  test("returns null on empty / nullish input", () => {
    assert.equal(nonparaClassLabel(null), null);
    assert.equal(nonparaClassLabel(undefined), null);
    assert.equal(nonparaClassLabel(""), null);
    assert.equal(nonparaClassLabel("  "), null);
  });
});

describe("paraCodeLabel", () => {
  test("resolves WAF para codes to className", () => {
    assert.equal(paraCodeLabel("U"), "PIU Standing");
    assert.equal(paraCodeLabel("D"), "PID Sitting");
    assert.equal(paraCodeLabel("UJ"), "PIU Junior 23");
  });

  test("falls back to the raw input when the code is unknown", () => {
    assert.equal(paraCodeLabel("ZZ"), "ZZ");
  });

  test("returns null on empty / nullish input", () => {
    assert.equal(paraCodeLabel(null), null);
    assert.equal(paraCodeLabel(""), null);
  });
});

describe("classLabelsForCard", () => {
  test("joins non-para and para labels with commas", () => {
    assert.equal(
      classLabelsForCard({
        nonparaClasses: ["SENIOR"],
        paraCodes: ["U"],
      }),
      "Senior, PIU Standing",
    );
  });

  test("preserves input order: non-para first, then para", () => {
    assert.equal(
      classLabelsForCard({
        nonparaClasses: ["JUNIOR 18", "SENIOR"],
        paraCodes: [],
      }),
      "Junior 18, Senior",
    );
  });

  test("de-duplicates equivalent labels", () => {
    assert.equal(
      classLabelsForCard({
        nonparaClasses: ["SENIOR", "Senior", "SENIOR"],
      }),
      "Senior",
    );
  });

  test("drops null/empty entries", () => {
    assert.equal(
      classLabelsForCard({
        nonparaClasses: [null, "SENIOR", "", undefined, "MASTER"],
        paraCodes: [null, "", undefined],
      }),
      "Senior, Master",
    );
  });

  test("returns null when nothing usable is left", () => {
    assert.equal(classLabelsForCard({}), null);
    assert.equal(
      classLabelsForCard({ nonparaClasses: [], paraCodes: [] }),
      null,
    );
    assert.equal(
      classLabelsForCard({ nonparaClasses: [null, ""] }),
      null,
    );
  });
});

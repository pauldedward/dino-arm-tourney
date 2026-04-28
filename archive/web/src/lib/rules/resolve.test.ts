// Minimal native-node tests for the category resolver. Run with:
//   node --import tsx --test web/src/lib/rules/resolve.test.ts
// or via `npm test` if a test script is added.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEntries, type RegistrationLite } from "./resolve";

const baseAble: RegistrationLite = {
  id: "r1",
  division: "Men",
  declared_weight_kg: 78,
  age_categories: ["Senior"],
  youth_hand: null,
  senior_hand: "R",
  is_para: false,
  para_class: null,
};

test("able-bodied senior right-hand: single entry", () => {
  const out = resolveEntries(baseAble, null);
  assert.equal(out.length, 1);
  assert.equal(out[0].hand, "R");
  assert.equal(out[0].age_band, "Senior");
  assert.match(out[0].weight_class, /^IM-/);
});

test("both-hands (B) expands to R+L", () => {
  const out = resolveEntries({ ...baseAble, senior_hand: "B" }, null);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.hand).sort(), ["L", "R"]);
});

test("youth + senior age bands each get entries", () => {
  const out = resolveEntries(
    {
      ...baseAble,
      age_categories: ["Junior", "Senior"],
      youth_hand: "R",
      senior_hand: "R",
    },
    null
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.age_band).sort(), ["Junior", "Senior"]);
});

test("measured weigh-in overrides declared weight", () => {
  const light = resolveEntries({ ...baseAble, declared_weight_kg: 78 }, { measured_kg: 58 });
  const heavy = resolveEntries({ ...baseAble, declared_weight_kg: 78 }, { measured_kg: 95 });
  assert.notEqual(light[0].weight_class, heavy[0].weight_class);
});

test("para athlete always produces exactly one entry", () => {
  const out = resolveEntries(
    {
      ...baseAble,
      is_para: true,
      para_class: "PD1",
      senior_hand: "B",
      age_categories: ["Senior"],
    },
    null
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].age_band, "PD1");
});

test("no age categories = no entries", () => {
  const out = resolveEntries({ ...baseAble, age_categories: [] }, null);
  assert.equal(out.length, 0);
});

test("category_code is unique per (div,band,weight,hand)", () => {
  const a = resolveEntries(baseAble, null)[0];
  const b = resolveEntries({ ...baseAble, senior_hand: "L" }, null)[0];
  assert.notEqual(a.category_code, b.category_code);
});

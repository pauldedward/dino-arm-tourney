import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupRegistrationsByCategory,
  type CategoryGroupReg,
} from "./group-by-category";

function reg(over: Partial<CategoryGroupReg> = {}): CategoryGroupReg {
  return {
    id: "r1",
    gender: "M",
    declared_weight_kg: 80,
    nonpara_classes: ["SENIOR"],
    nonpara_hands: ["R"],
    para_codes: [],
    para_hand: null,
    chest_no: 1,
    full_name: "Athlete One",
    district: "Chennai",
    ...over,
  };
}

describe("groupRegistrationsByCategory", () => {
  it("produces a group with a single athlete (no filtering)", () => {
    const groups = groupRegistrationsByCategory([reg()], new Map());
    assert.equal(groups.length, 1);
    assert.equal(groups[0].athletes.length, 1);
    assert.equal(groups[0].athletes[0].full_name, "Athlete One");
  });

  it("hand=B fans out to R + L category codes", () => {
    const groups = groupRegistrationsByCategory(
      [reg({ nonpara_hands: ["B"] })],
      new Map()
    );
    assert.equal(groups.length, 2);
    const codes = groups.map((g) => g.category_code);
    assert.ok(codes.some((c) => c.endsWith("-R")));
    assert.ok(codes.some((c) => c.endsWith("-L")));
  });

  it("uses measured weight from weigh-in over declared", () => {
    // declared 80 lands in one bucket; measured 95 lands in a heavier bucket
    const r = reg({ declared_weight_kg: 80 });
    const wi = new Map([[r.id, { measured_kg: 95 }]]);
    const declaredGroups = groupRegistrationsByCategory([r], new Map());
    const weighedGroups = groupRegistrationsByCategory([r], wi);
    assert.notEqual(
      declaredGroups[0].category_code,
      weighedGroups[0].category_code
    );
  });

  it("groups multiple athletes into the same category", () => {
    const groups = groupRegistrationsByCategory(
      [
        reg({ id: "a", chest_no: 2 }),
        reg({ id: "b", chest_no: 1, full_name: "Athlete Two" }),
      ],
      new Map()
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].athletes.length, 2);
    // sorted by chest_no asc
    assert.equal(groups[0].athletes[0].chest_no, 1);
  });

  it("returns empty when no registrations resolve", () => {
    const groups = groupRegistrationsByCategory(
      [reg({ nonpara_classes: [], nonpara_hands: [] })],
      new Map()
    );
    assert.equal(groups.length, 0);
  });
});

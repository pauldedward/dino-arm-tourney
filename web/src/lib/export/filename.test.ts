import test from "node:test";
import assert from "node:assert/strict";
import { exportFilename, slugify, todayStamp } from "./filename";

test("slugify lowercases and kebab-cases", () => {
  assert.equal(slugify("TN State 2026"), "tn-state-2026");
  assert.equal(slugify("Coimbatore — District!!"), "coimbatore-district");
  assert.equal(slugify(null), "event");
  assert.equal(slugify(""), "event");
});

test("todayStamp returns YYYY-MM-DD", () => {
  assert.equal(todayStamp(new Date("2026-04-27T18:30:00Z")), "2026-04-27");
});

test("exportFilename prefers slug over name", () => {
  assert.equal(
    exportFilename({
      eventSlug: "tn-state-2026",
      eventName: "TN State 2026",
      kind: "nominal",
      ext: "pdf",
      date: new Date("2026-04-27T00:00:00Z"),
    }),
    "tn-state-2026-nominal-2026-04-27.pdf"
  );
});

test("exportFilename slugifies eventName when slug missing", () => {
  assert.equal(
    exportFilename({
      eventName: "TN State 2026",
      kind: "registrations",
      ext: "csv",
      date: new Date("2026-04-27T00:00:00Z"),
    }),
    "tn-state-2026-registrations-2026-04-27.csv"
  );
});

test("exportFilename appends optional suffix", () => {
  assert.equal(
    exportFilename({
      eventSlug: "tn-state-2026",
      kind: "category",
      suffix: "M-S-78",
      ext: "csv",
      date: new Date("2026-04-27T00:00:00Z"),
    }),
    "tn-state-2026-category-m-s-78-2026-04-27.csv"
  );
});

test("exportFilename omits event part when no event given", () => {
  assert.equal(
    exportFilename({
      kind: "audit-log",
      ext: "csv",
      date: new Date("2026-04-27T00:00:00Z"),
    }),
    "audit-log-2026-04-27.csv"
  );
});

test("exportFilename can skip date", () => {
  assert.equal(
    exportFilename({
      eventSlug: "tn-state-2026",
      kind: "fixtures",
      suffix: "M-S-78",
      ext: "csv",
      includeDate: false,
    }),
    "tn-state-2026-fixtures-m-s-78.csv"
  );
});

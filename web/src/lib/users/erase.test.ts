import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planErasure,
  buildRegistrationScrubPatch,
  DELETED_USER_LABEL,
  DELETED_ATHLETE_LABEL,
  type ErasureTarget,
} from "./erase";

const baseTarget: ErasureTarget = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Alice",
  role: "operator",
  erase_started_at: null,
};

describe("planErasure: guards", () => {
  it("refuses self-erasure", () => {
    const r = planErasure({
      target: baseTarget,
      actorId: baseTarget.id,
      otherActiveSuperAdminCount: 5,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /self/i);
  });

  it("refuses erasing the last active super admin", () => {
    const r = planErasure({
      target: { ...baseTarget, role: "super_admin" },
      actorId: "00000000-0000-0000-0000-0000000000aa",
      otherActiveSuperAdminCount: 0,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /super admin/i);
  });

  it("allows erasing a super admin if another active super admin exists", () => {
    const r = planErasure({
      target: { ...baseTarget, role: "super_admin" },
      actorId: "00000000-0000-0000-0000-0000000000aa",
      otherActiveSuperAdminCount: 1,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resume, false);
  });

  it("flags resume=true when erase_started_at is already stamped", () => {
    const r = planErasure({
      target: { ...baseTarget, erase_started_at: "2026-04-30T00:00:00Z" },
      actorId: "00000000-0000-0000-0000-0000000000aa",
      otherActiveSuperAdminCount: 5,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resume, true);
  });

  it("still applies guards when resuming a stuck erase (cannot resume self)", () => {
    const r = planErasure({
      target: { ...baseTarget, erase_started_at: "2026-04-30T00:00:00Z" },
      actorId: baseTarget.id,
      otherActiveSuperAdminCount: 5,
    });
    assert.equal(r.ok, false);
  });
});

describe("buildRegistrationScrubPatch", () => {
  it("replaces full_name with the deleted-athlete placeholder and nulls all PII", () => {
    const patch = buildRegistrationScrubPatch();
    assert.equal(patch.full_name, "Deleted athlete");
    assert.equal(patch.initial, null);
    assert.equal(patch.mobile, null);
    assert.equal(patch.aadhaar, null);
    assert.equal(patch.aadhaar_masked, null);
    assert.equal(patch.photo_url, null);
    assert.equal(patch.photo_bytes, null);
    assert.equal(patch.dob, null);
    assert.equal(patch.district, null);
    assert.equal(patch.team, null);
  });

  it("does not touch tournament-data fields (no gender / weight_class_code keys present)", () => {
    const patch = buildRegistrationScrubPatch();
    const keys = Object.keys(patch);
    assert.ok(!keys.includes("gender"));
    assert.ok(!keys.includes("weight_class_code"));
    assert.ok(!keys.includes("division"));
    assert.ok(!keys.includes("hand"));
    assert.ok(!keys.includes("status"));
  });
});

describe("display fallback labels", () => {
  it("exports stable strings for the UI fallback contract", () => {
    assert.equal(DELETED_USER_LABEL, "Deleted user");
    assert.equal(DELETED_ATHLETE_LABEL, "Deleted athlete");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { feeFor, feeBothChannels } from "./fee";

describe("feeFor", () => {
  it("returns the online fee for the online channel", () => {
    assert.equal(
      feeFor("online", { entry_fee_default_inr: 500, entry_fee_offline_inr: 300 }),
      500
    );
  });

  it("returns the offline override for the offline channel", () => {
    assert.equal(
      feeFor("offline", { entry_fee_default_inr: 500, entry_fee_offline_inr: 300 }),
      300
    );
  });

  it("falls back to the online fee when offline is null", () => {
    assert.equal(
      feeFor("offline", { entry_fee_default_inr: 500, entry_fee_offline_inr: null }),
      500
    );
  });

  it("falls back to the online fee when offline is undefined (legacy events)", () => {
    assert.equal(feeFor("offline", { entry_fee_default_inr: 500 }), 500);
  });

  it("treats null online fee as 0", () => {
    assert.equal(feeFor("online", { entry_fee_default_inr: null }), 0);
    assert.equal(
      feeFor("offline", { entry_fee_default_inr: null, entry_fee_offline_inr: null }),
      0
    );
  });

  it("clamps negative values to 0", () => {
    assert.equal(
      feeFor("offline", { entry_fee_default_inr: 500, entry_fee_offline_inr: -100 }),
      0
    );
  });

  it("rounds non-integer inputs", () => {
    assert.equal(
      feeFor("offline", { entry_fee_default_inr: 500, entry_fee_offline_inr: 249.6 }),
      250
    );
  });

  it("offline fee of 0 is honoured (not treated as missing)", () => {
    assert.equal(
      feeFor("offline", { entry_fee_default_inr: 500, entry_fee_offline_inr: 0 }),
      0
    );
  });
});

describe("feeBothChannels", () => {
  it("returns both per-channel fees in one call", () => {
    assert.deepEqual(
      feeBothChannels({ entry_fee_default_inr: 500, entry_fee_offline_inr: 300 }),
      { online: 500, offline: 300 }
    );
  });

  it("offline mirrors online when no override is set", () => {
    assert.deepEqual(
      feeBothChannels({ entry_fee_default_inr: 500 }),
      { online: 500, offline: 500 }
    );
  });
});

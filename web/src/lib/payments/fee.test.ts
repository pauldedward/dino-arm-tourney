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

  describe("para offline pricing", () => {
    it("online ignores the para override (online always uses default)", () => {
      assert.equal(
        feeFor(
          "online",
          { entry_fee_default_inr: 500, entry_fee_offline_inr: 300, entry_fee_para_inr: 100 },
          { isPara: true }
        ),
        500
      );
    });

    it("uses the para override when the para flag is set", () => {
      assert.equal(
        feeFor(
          "offline",
          { entry_fee_default_inr: 500, entry_fee_offline_inr: 300, entry_fee_para_inr: 100 },
          { isPara: true }
        ),
        100
      );
    });

    it("para override is honoured even when the offline override is null", () => {
      assert.equal(
        feeFor(
          "offline",
          { entry_fee_default_inr: 500, entry_fee_para_inr: 100 },
          { isPara: true }
        ),
        100
      );
    });

    it("falls through para → offline → default when para is null", () => {
      assert.equal(
        feeFor(
          "offline",
          { entry_fee_default_inr: 500, entry_fee_offline_inr: 300, entry_fee_para_inr: null },
          { isPara: true }
        ),
        300
      );
    });

    it("falls through to default when both para and offline are null", () => {
      assert.equal(
        feeFor(
          "offline",
          { entry_fee_default_inr: 500, entry_fee_offline_inr: null, entry_fee_para_inr: null },
          { isPara: true }
        ),
        500
      );
    });

    it("para fee of 0 is honoured (free para entries)", () => {
      assert.equal(
        feeFor(
          "offline",
          { entry_fee_default_inr: 500, entry_fee_offline_inr: 300, entry_fee_para_inr: 0 },
          { isPara: true }
        ),
        0
      );
    });

    it("non-para offline ignores the para override", () => {
      assert.equal(
        feeFor(
          "offline",
          { entry_fee_default_inr: 500, entry_fee_offline_inr: 300, entry_fee_para_inr: 100 },
          { isPara: false }
        ),
        300
      );
    });
  });
});

describe("feeBothChannels", () => {
  it("returns every per-channel fee in one call", () => {
    assert.deepEqual(
      feeBothChannels({
        entry_fee_default_inr: 500,
        entry_fee_offline_inr: 300,
        entry_fee_para_inr: 100,
      }),
      { online: 500, offline: 300, para: 100 }
    );
  });

  it("offline + para mirror online when no overrides are set", () => {
    assert.deepEqual(
      feeBothChannels({ entry_fee_default_inr: 500 }),
      { online: 500, offline: 500, para: 500 }
    );
  });

  it("para mirrors offline when only the offline override is set", () => {
    assert.deepEqual(
      feeBothChannels({ entry_fee_default_inr: 500, entry_fee_offline_inr: 300 }),
      { online: 500, offline: 300, para: 300 }
    );
  });
});

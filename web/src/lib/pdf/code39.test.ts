import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CODE39_PATTERNS,
  encodeCode39,
  code39Width,
  fitNarrowToWidth,
  quietZone,
  sanitizeCode39,
} from "./code39";

describe("Code 39 alphabet table", () => {
  it("contains 40 symbols (0-9, A-Z, *, -, ., space) — standard Code 39 minus the $/+/%/' specials we don't use", () => {
    assert.equal(Object.keys(CODE39_PATTERNS).length, 40);
  });

  it("every pattern is 9 elements long", () => {
    for (const [ch, pat] of Object.entries(CODE39_PATTERNS)) {
      assert.equal(pat.length, 9, `pattern for ${ch} must be 9 elements`);
    }
  });

  it("every pattern uses exactly 3 wide + 6 narrow elements", () => {
    for (const [ch, pat] of Object.entries(CODE39_PATTERNS)) {
      const wides = pat.split("").filter((c) => c === "w").length;
      const narrows = pat.split("").filter((c) => c === "n").length;
      assert.equal(wides, 3, `${ch}: expected 3 wide elements`);
      assert.equal(narrows, 6, `${ch}: expected 6 narrow elements`);
    }
  });

  it("only uses 'n' or 'w' characters in patterns", () => {
    for (const [ch, pat] of Object.entries(CODE39_PATTERNS)) {
      assert.match(pat, /^[nw]+$/, `${ch}: invalid pattern chars`);
    }
  });
});

describe("sanitizeCode39", () => {
  it("uppercases input", () => {
    assert.equal(sanitizeCode39("abc"), "ABC");
  });

  it("strips characters not in the alphabet", () => {
    assert.equal(sanitizeCode39("hello, world!"), "HELLO WORLD");
  });

  it("strips bare asterisks since the encoder adds its own sentinels", () => {
    assert.equal(sanitizeCode39("*1*2*"), "12");
  });

  it("returns empty string when nothing is encodable", () => {
    assert.equal(sanitizeCode39("@@@"), "");
  });
});

describe("encodeCode39", () => {
  it("emits 5 bars per encoded character", () => {
    // Sentinel * + "0001" + sentinel * = 6 chars * 5 bars = 30 bars
    const r = encodeCode39("0001", 1, 2);
    assert.equal(r.bars.length, 30);
  });

  it("rejects non-positive narrow width", () => {
    assert.throws(() => encodeCode39("1", 0, 2));
    assert.throws(() => encodeCode39("1", -1, 2));
  });

  it("rejects wide <= narrow (Code 39 needs ratio > 1)", () => {
    assert.throws(() => encodeCode39("1", 2, 2));
    assert.throws(() => encodeCode39("1", 2, 1));
  });

  it("totalWidth matches code39Width formula for known input", () => {
    // ratio = 2.5 (recommended), narrow = 1
    // chars including sentinels = 6 (*1234*)
    // unitsPerChar = 3*2.5 + 6 = 13.5
    // total = 6 * 13.5 + 5 = 86
    const r = encodeCode39("1234", 1, 2.5);
    assert.equal(r.totalWidth, 86);
    assert.equal(code39Width("1234", 1, 2.5), 86);
  });

  it("first bar starts at x = 0", () => {
    const r = encodeCode39("1", 1, 2.5);
    assert.equal(r.bars[0].x, 0);
  });

  it("bars never overlap", () => {
    const r = encodeCode39("HELLO123", 1, 2.5);
    for (let i = 1; i < r.bars.length; i++) {
      const prev = r.bars[i - 1];
      const cur = r.bars[i];
      assert.ok(
        cur.x >= prev.x + prev.w,
        `bar ${i} overlaps previous (prev x=${prev.x} w=${prev.w}, cur x=${cur.x})`,
      );
    }
  });

  it("last bar's right edge does not exceed totalWidth", () => {
    const r = encodeCode39("CHEST123", 1, 2.5);
    const last = r.bars[r.bars.length - 1];
    assert.ok(last.x + last.w <= r.totalWidth + 1e-9);
  });

  it("scales linearly: doubling narrow doubles totalWidth", () => {
    const a = encodeCode39("999", 1, 2.5);
    const b = encodeCode39("999", 2, 5);
    assert.equal(b.totalWidth, a.totalWidth * 2);
  });

  it("ignores characters outside the Code 39 alphabet", () => {
    // "@" is not in the alphabet; should be sanitized out, so width
    // should match encoding "12"
    const a = encodeCode39("12@", 1, 2.5);
    const b = encodeCode39("12", 1, 2.5);
    assert.equal(a.totalWidth, b.totalWidth);
  });
});

describe("fitNarrowToWidth", () => {
  it("returns a narrow such that the full barcode + quiet zones fits exactly", () => {
    const value = "0001";
    const available = 137; // pt -- typical card body width
    const ratio = 2.5;
    const n = fitNarrowToWidth(value, available, ratio);
    const wide = n * ratio;
    const code = code39Width(value, n, wide);
    const qz = quietZone(n);
    const total = code + 2 * qz;
    assert.ok(Math.abs(total - available) < 1e-9, `expected ~${available}, got ${total}`);
  });

  it("yields a smaller narrow for longer values in the same width", () => {
    const ratio = 2.5;
    const wShort = fitNarrowToWidth("1", 137, ratio);
    const wLong = fitNarrowToWidth("123456789", 137, ratio);
    assert.ok(wLong < wShort, "longer value should need narrower modules");
  });

  it("yields a larger narrow when more width is available", () => {
    const ratio = 2.5;
    const small = fitNarrowToWidth("0001", 80, ratio);
    const large = fitNarrowToWidth("0001", 200, ratio);
    assert.ok(large > small);
  });
});

describe("quietZone", () => {
  it("is exactly 10x the narrow module (Code 39 spec)", () => {
    assert.equal(quietZone(1), 10);
    assert.equal(quietZone(0.5), 5);
    assert.equal(quietZone(2), 20);
  });
});

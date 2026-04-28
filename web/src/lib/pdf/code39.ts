/**
 * Pure Code 39 encoder. No React / react-pdf imports so it can be unit
 * tested directly with `node --test`.
 *
 * Code 39 was chosen because every cheap USB barcode scanner reads it
 * out of the box with no configuration, and the encoding is purely
 * public-domain. Each character is encoded as 9 elements alternating
 * bar / space / bar / space / ... (5 bars, 4 spaces). Of the 9 elements,
 * exactly 3 are wide and 6 are narrow.
 *
 * References:
 *   - ISO/IEC 16388:2007 (Code 39 specification)
 *   - https://en.wikipedia.org/wiki/Code_39
 */

/** Each pattern is 9 chars. `n` = narrow element, `w` = wide element. */
export const CODE39_PATTERNS: Readonly<Record<string, string>> = Object.freeze({
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  "*": "nwnnwnwnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  A: "wnnnnwnnw",
  B: "nnnwnwnnw",
  C: "wnnwnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnnwwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnnwnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnnwnnnww",
  M: "wnnwnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnnwwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnnwnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
});

export type EncodedBar = { x: number; w: number };

export type EncodeResult = {
  /** All bar rectangles to draw (positions relative to the bar field). */
  bars: EncodedBar[];
  /** Width of the encoded barcode itself, NOT including quiet zones. */
  totalWidth: number;
  /** Width of one narrow module (== `narrow` arg, returned for convenience). */
  narrow: number;
  /** Width of one wide module. */
  wide: number;
};

/** Sanitize the input so unknown chars never produce mis-encoded output. */
export function sanitizeCode39(value: string): string {
  return value
    .toUpperCase()
    .split("")
    .filter((c) => c !== "*" && c in CODE39_PATTERNS)
    .join("");
}

/**
 * Encode `value` as Code 39 bars at the given module widths.
 * Wraps the value in start/stop `*` sentinels automatically.
 *
 * `narrow` and `wide` are caller-supplied so the renderer can size the
 * barcode to the available space. The Code 39 spec requires
 * `2.0 <= wide/narrow <= 3.0`; we recommend 2.5 for cheap scanners.
 */
export function encodeCode39(
  value: string,
  narrow: number,
  wide: number
): EncodeResult {
  if (narrow <= 0) throw new Error("encodeCode39: narrow must be > 0");
  if (wide <= narrow) throw new Error("encodeCode39: wide must be > narrow");

  const safe = sanitizeCode39(value);
  const full = `*${safe}*`;
  const bars: EncodedBar[] = [];
  let x = 0;
  for (let i = 0; i < full.length; i++) {
    const ch = full[i];
    const pat = CODE39_PATTERNS[ch];
    // Sanitization above guarantees pat exists, but we keep this guard
    // so the function is safe to call directly with arbitrary input.
    if (!pat) continue;
    for (let j = 0; j < pat.length; j++) {
      const isWide = pat[j] === "w";
      const w = isWide ? wide : narrow;
      const isBar = j % 2 === 0; // 0,2,4,6,8 = bar; 1,3,5,7 = space
      if (isBar) bars.push({ x, w });
      x += w;
    }
    // Inter-character gap: one narrow space between every char (incl. after
    // the last char, which we strip from totalWidth below).
    x += narrow;
  }
  const totalWidth = x - narrow;
  return { bars, totalWidth, narrow, wide };
}

/**
 * Compute the encoded width given a narrow module width, without
 * actually generating bar rectangles. Useful for sizing decisions.
 *
 * Each Code 39 char takes 13 narrow-equivalents (3 wide + 6 narrow + 1
 * inter-char space) when wide:narrow is exactly the supplied ratio.
 */
export function code39Width(
  value: string,
  narrow: number,
  wide: number
): number {
  const safe = sanitizeCode39(value);
  const charsIncludingSentinels = safe.length + 2; // *value*
  if (charsIncludingSentinels === 0) return 0;
  const widthPerChar = 3 * wide + 6 * narrow; // 3 wide + 6 narrow elements
  // (n chars * width) + (n-1) inter-char gaps of one narrow each
  return charsIncludingSentinels * widthPerChar + (charsIncludingSentinels - 1) * narrow;
}

/**
 * Solve for the narrow module width that makes the barcode (including
 * a 10× narrow quiet zone on each side) fit exactly within `availableWidth`.
 *
 * Quiet zone = 10 * narrow each side.
 * Total width = code39Width(value, n, n*ratio) + 2 * (10 * n)
 *             = (charsAndSentinels * (3*ratio + 6) + (charsAndSentinels-1) + 20) * n
 * Solve for n.
 */
export function fitNarrowToWidth(
  value: string,
  availableWidth: number,
  ratio: number
): number {
  const safe = sanitizeCode39(value);
  const c = safe.length + 2; // +2 for start/stop *
  const unitsPerChar = 3 * ratio + 6;
  const totalUnits = c * unitsPerChar + (c - 1) + 20; // +20 for both quiet zones
  return availableWidth / totalUnits;
}

/** Recommended quiet zone for a given narrow module (Code 39 spec: 10×). */
export function quietZone(narrow: number): number {
  return narrow * 10;
}

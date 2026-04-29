// One-shot mojibake fixer. Idempotent.
// Walks web/src for .ts/.tsx and replaces known cp1252-misdecoded UTF-8.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("web/src");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mdx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

const TARGETS = walk(ROOT);

// Common Windows-cp1252-misdecoded UTF-8 sequences -> intended chars.
// Order matters: longer sequences first so they win over shorter prefixes.
const MAP = [
  ["Ã¢â‚¬â€œ", "–"], // en dash
  ["Ã¢â‚¬â€\u009D", "—"], // em dash variant
  ["Ã¢â‚¬Â¦", "…"],
  ["Ã¢â€ â€™", "→"],
  ["Ã¢â‚¬\u009D", "”"],
  ["Ã¢â‚¬Å“", "“"],
  ["Ã¢â‚¬Ëœ", "‘"],
  ["Ã¢â‚¬â„¢", "’"],
  ["â†'", "→"],
  ["â†’", "→"],
  ["â†", "←"],
  ["â€”", "—"],
  ["â€“", "–"],
  ["â€¦", "…"],
  ["â€˜", "‘"],
  ["â€™", "’"],
  ["â€œ", "“"],
  ["â€\u009D", "”"],
  ["â€", "—"], // any leftover bare â€ pair → em dash (last-resort)
  ["Â·", "·"],
  ["â‚¹", "₹"],
  ["Ã©", "é"],
  ["Ã¨", "è"],
];

let total = 0;
for (const p of TARGETS) {
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, "utf8");
  let n = 0;
  // Strip C1 control chars (U+0080..U+009F) — invisible junk leftover from
  // cp1252-misdecoded UTF-8. Renders as a tofu-like glyph in the browser.
  const stripped = s.replace(/[\u0080-\u009F]/g, "");
  if (stripped.length !== s.length) {
    n += s.length - stripped.length;
    s = stripped;
  }
  for (const [bad, good] of MAP) {
    const parts = s.split(bad);
    if (parts.length > 1) {
      n += parts.length - 1;
      s = parts.join(good);
    }
  }
  if (n > 0) {
    fs.writeFileSync(p, s, "utf8");
    console.log(`${path.relative(process.cwd(), p)}: ${n} replacements`);
    total += n;
  }
}
console.log(`\ntotal: ${total}`);

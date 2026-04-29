// One-shot mojibake fixer. Idempotent.
import fs from "node:fs";
import path from "node:path";

const TARGETS = [
  "web/src/app/admin/events/[id]/print/[kind]/page.tsx",
  "web/src/app/register-super-admin/RegisterForm.tsx",
];

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
for (const rel of TARGETS) {
  const p = path.resolve(rel);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, "utf8");
  let n = 0;
  for (const [bad, good] of MAP) {
    const parts = s.split(bad);
    if (parts.length > 1) {
      n += parts.length - 1;
      s = parts.join(good);
    }
  }
  fs.writeFileSync(p, s, "utf8");
  console.log(`${rel}: ${n} replacements`);
  total += n;
}
console.log(`\ntotal: ${total}`);

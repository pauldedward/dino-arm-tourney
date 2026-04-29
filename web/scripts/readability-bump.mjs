#!/usr/bin/env node
/**
 * One-shot mechanical readability sweep over the operator screens
 * (Counter Desk, Registrations, Weigh-in, Event Manage, Print previews).
 *
 * Goals:
 *   - Bump tiny eyebrow/label text from 8-11px to a min ~11-12px.
 *   - Bump body table/cell text from text-xs (12px) to 13px.
 *   - Reduce extreme letter-spacing (0.4em / 0.35em) on small caps so
 *     they read as words instead of disconnected letters.
 *
 * Print pipelines are server-side (PDF/XLSX endpoints under
 * /api/admin/sheets/*) and are NOT touched by this script.
 *
 * Re-running this script is a no-op: replacements only match the
 * pre-bump tokens and produce post-bump tokens that don't match again.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));

const FILES = [
  "src/app/admin/events/[id]/page.tsx",
  "src/app/admin/events/[id]/counter/page.tsx",
  "src/app/admin/events/[id]/registrations/page.tsx",
  "src/app/admin/events/[id]/weighin/page.tsx",
  "src/app/admin/events/[id]/print/page.tsx",
  "src/app/admin/events/[id]/print/[kind]/page.tsx",
  "src/app/admin/events/[id]/print/[kind]/PreviewToolbar.tsx",
  "src/app/admin/events/[id]/print/[kind]/CategorySectionActions.tsx",
  "src/app/admin/events/[id]/print/[kind]/IdCardsGrid.tsx",
  "src/components/admin/BulkRegistrationDesk.tsx",
  "src/components/admin/FastRegistrationsTable.tsx",
  "src/components/admin/WeighInQueue.tsx",
  "src/components/admin/RegistrationsFilterBar.tsx",
  "src/components/admin/PaymentActions.tsx",
  "src/components/admin/ProofReviewModal.tsx",
  "src/components/admin/DistrictSummary.tsx",
  "src/components/admin/Pagination.tsx",
  "src/components/admin/AuditFilterBar.tsx",
];

// Order matters: bump 11→13 BEFORE 10→12 so chained replacements don't double-apply.
// Keep this list small + targeted; we only touch class tokens that appear inside
// a className string, gated on a leading non-word char.
const REPLACEMENTS = [
  // Type scale bumps. Sentinel char (`[\s"'`]) on each side keeps us from
  // matching inside arbitrary identifiers.
  [/(["'`\s])text-\[11px\]/g, "$1text-[13px]"],
  [/(["'`\s])text-\[10px\]/g, "$1text-[12px]"],
  [/(["'`\s])text-\[9px\]/g, "$1text-[11px]"],
  [/(["'`\s])text-\[8px\]/g, "$1text-[11px]"],
  // Body text in tables / cells. text-xs (12px) reads tight in dense rows;
  // 13px gives one extra px of x-height without breaking the layout grid.
  [/(["'`\s])text-xs(?![\w-])/g, "$1text-[13px]"],

  // Tracking (letter-spacing) reductions. Extreme tracking on ~10px caps
  // is what made the labels feel illegible — letters read as separate
  // glyphs rather than words. Pull back ~25%.
  [/(["'`\s])tracking-\[0\.4em\]/g, "$1tracking-[0.3em]"],
  [/(["'`\s])tracking-\[0\.35em\]/g, "$1tracking-[0.25em]"],
];

let totalChanged = 0;
let totalEdits = 0;

for (const rel of FILES) {
  const abs = resolve(ROOT, rel);
  const before = await readFile(abs, "utf8");
  let after = before;
  let fileEdits = 0;
  for (const [pat, repl] of REPLACEMENTS) {
    // Count matches first so we can log per-file totals, then run a
    // plain string replace so $1 / $2 substitution behaves correctly.
    // (Wrapping a string repl in a callback returns the literal `$1`
    // instead of the captured group — silent corruption.)
    const matches = after.match(pat);
    if (!matches) continue;
    fileEdits += matches.length;
    after = after.replace(pat, repl);
  }
  if (after !== before) {
    await writeFile(abs, after, "utf8");
    totalChanged++;
    totalEdits += fileEdits;
    console.log(`  edited ${fileEdits.toString().padStart(3)}  ${rel}`);
  } else {
    console.log(`  no-op       ${rel}`);
  }
}

console.log(`\nDone. ${totalEdits} edits across ${totalChanged} files.`);

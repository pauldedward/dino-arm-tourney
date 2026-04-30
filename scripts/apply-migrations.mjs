#!/usr/bin/env node
// Apply PENDING Supabase migrations to a target project.
//
// PENDING = files at supabase/migrations/*.sql that are NOT under legacy/.
// Anything under supabase/migrations/legacy/ is already on prod and bundled
// into supabase/schema.sql — this script will not touch them.
// See supabase/migrations/README.md for the convention.
//
// Usage (PowerShell):
//   $env:SUPABASE_DB_URL = "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
//   node scripts/apply-migrations.mjs --target prod --file 0045_xxx.sql
//   node scripts/apply-migrations.mjs --target prod --all-pending
//
// Requires `psql` on PATH (`winget install PostgreSQL.PostgreSQL` or any
// libpq install).
//
// Safety:
//   * Refuses to run unless --target is given (forces you to think about WHERE).
//   * Dry-runs by default; pass --apply to actually execute.
//   * Wraps each file in a transaction (psql -1) so partial failure rolls back.
//   * After success, reminds you to `git mv` the file into legacy/ and re-run
//     `npm run schema:bundle` in the same PR.

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "supabase", "migrations");

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--target") out.target = argv[++i];
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--all-pending") out.allPending = true;
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function listPending() {
  // Top-level *.sql only; ignore legacy/ subfolder.
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && /^\d{4}_.+\.sql$/.test(d.name))
    .map((d) => d.name)
    .sort();
}

function pickFiles(args) {
  if (args.file) {
    const p = join(MIGRATIONS_DIR, args.file);
    if (!existsSync(p)) {
      console.error(`File not found in pending set: ${p}`);
      console.error("Hint: a file already moved into legacy/ has already been applied.");
      process.exit(2);
    }
    return [args.file];
  }
  if (args.allPending) return listPending();
  console.error("Provide --file <name.sql> or --all-pending");
  process.exit(2);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.target) {
    console.error("Required: --target <prod|dev>  (just a label, makes the log obvious)");
    process.exit(2);
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("Set SUPABASE_DB_URL env var (postgres connection string).");
    process.exit(2);
  }

  const files = pickFiles(args);
  if (!files.length) {
    console.log("No pending migrations to apply.");
    return;
  }

  console.log(`Target: ${args.target}`);
  console.log(`Pending files (${files.length}):`);
  for (const f of files) console.log(`  - ${f}`);

  if (!args.apply) {
    console.log("\nDry run. Re-run with --apply to execute.");
    return;
  }

  for (const f of files) {
    const full = join(MIGRATIONS_DIR, f);
    console.log(`\n>>> Applying ${f}`);
    const res = spawnSync(
      "psql",
      ["-v", "ON_ERROR_STOP=1", "-1", "-f", full, dbUrl],
      { stdio: "inherit" },
    );
    if (res.status !== 0) {
      console.error(`FAILED on ${f} (exit ${res.status}). Aborting.`);
      process.exit(res.status ?? 1);
    }
    console.log(
      `OK. In your PR, move it into legacy/ and re-bundle:\n` +
        `  git mv supabase/migrations/${f} supabase/migrations/legacy/${f}\n` +
        `  cd web && npm run schema:bundle && git add ../supabase/schema.sql`,
    );
  }
}

main();

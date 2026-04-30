#!/usr/bin/env node
// Apply pending Supabase migrations to a target project.
//
// Usage (PowerShell):
//   $env:SUPABASE_DB_URL = "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
//   node scripts/apply-migrations.mjs --target prod --file 0045_xxx.sql
//   node scripts/apply-migrations.mjs --target prod --all-after 0044
//
// Requires the Supabase CLI (`npm i -g supabase`) OR `psql` on PATH.
// We shell out to `psql` because it's a single binary, no project link needed.
//
// Safety:
//   * Refuses to run unless --target is given (forces you to think about WHERE).
//   * Dry-runs by default; pass --apply to actually execute.
//   * Wraps each file in a transaction (psql -1) so partial failure rolls back.
//   * After success, prints the line you should append to
//     supabase/migrations/APPLIED-PROD.md.
//
// Does NOT update APPLIED-PROD.md automatically — that line is part of
// the PR diff so reviewers see it.

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
    else if (a === "--all-after") out.allAfter = argv[++i];
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

function pickFiles(args) {
  if (args.file) {
    const p = join(MIGRATIONS_DIR, args.file);
    if (!existsSync(p)) {
      console.error(`File not found: ${p}`);
      process.exit(2);
    }
    return [args.file];
  }
  if (args.allAfter) {
    const cutoff = String(args.allAfter).padStart(4, "0");
    return listMigrations().filter((f) => f.slice(0, 4) > cutoff);
  }
  console.error("Provide --file <name.sql> or --all-after <NNNN>");
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
    console.log("No migrations to apply.");
    return;
  }

  console.log(`Target: ${args.target}`);
  console.log(`Files (${files.length}):`);
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
    const today = new Date().toISOString().slice(0, 10);
    console.log(
      `OK. Append to supabase/migrations/APPLIED-PROD.md:\n  ${f} — ${today} — applied by <you> via cli`,
    );
  }
}

main();

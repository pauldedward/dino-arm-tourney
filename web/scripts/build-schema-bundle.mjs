#!/usr/bin/env node
// Concatenate every supabase/migrations/*.sql in numeric+alphabetic order
// into a single supabase/schema.sql you can paste into a fresh Supabase
// project's SQL Editor (or run via `psql -f`).
//
// Why this works: every migration uses idempotent guards
// (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
//  DROP CONSTRAINT IF EXISTS, ON CONFLICT DO NOTHING),
// so applying them in order to an empty DB is equivalent to applying
// the latest schema.
//
// Includes the seeded reference rows from 0001_init.sql
// (rule_profiles: WAF-2022 + IAFF-2024).
//
// Run from repo root:   node web/scripts/build-schema-bundle.mjs
// Or from web/:         npm run schema:bundle

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "..", "..", "supabase", "migrations");
const outFile = resolve(here, "..", "..", "supabase", "schema.sql");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // alphabetic == numeric prefix order; ties broken by name

if (files.length === 0) {
  console.error("No migrations found in", migrationsDir);
  process.exit(1);
}

const header = `-- ─────────────────────────────────────────────────────────────────────────────
-- Dino Arm Tourney — consolidated schema bundle
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   npm run schema:bundle    (from web/)
--
-- Source: supabase/migrations/*.sql (${files.length} files)
-- Generated: ${new Date().toISOString()}
--
-- Apply to a fresh Supabase project by pasting this whole file into the
-- SQL Editor (Supabase Dashboard → SQL Editor → New query → Run).
-- Idempotent: safe to re-run on a partially-applied DB.
-- ─────────────────────────────────────────────────────────────────────────────

`;

const chunks = [header];
for (const f of files) {
  const body = readFileSync(join(migrationsDir, f), "utf8");
  chunks.push(`-- ════════════════════════════════════════════════════════════════════════════\n`);
  chunks.push(`-- ${f}\n`);
  chunks.push(`-- ════════════════════════════════════════════════════════════════════════════\n`);
  chunks.push(body.endsWith("\n") ? body : body + "\n");
  chunks.push("\n");
}

writeFileSync(outFile, chunks.join(""), "utf8");
console.log(`Wrote ${outFile}`);
console.log(`Bundled ${files.length} migrations`);

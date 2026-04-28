#!/usr/bin/env node
/**
 * Dangerous: deletes ALL Supabase auth users and profiles rows.
 * Run with:  npm run users:reset -- --yes
 *
 * Safe-by-default: refuses unless --yes is passed.
 */

import { createClient } from "@supabase/supabase-js";

const confirmed =
  process.argv.includes("--yes") || process.env.CONFIRM_DROP_USERS === "yes";

if (!confirmed) {
  console.error(
    "Refusing to run. Set CONFIRM_DROP_USERS=yes or pass --yes.\n" +
      "Example: $env:CONFIRM_DROP_USERS='yes'; npm run users:reset"
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Null-out FK refs that would otherwise block profile deletion.
// (FK -> profiles does not have ON DELETE SET NULL for all tables.)
const nullOuts = [
  { table: "payments",    col: "verified_by" },
  { table: "weigh_ins",   col: "weighed_by" },
  { table: "events",      col: "created_by" },
];
for (const { table, col } of nullOuts) {
  const { error } = await sb.from(table).update({ [col]: null }).not(col, "is", null);
  if (error) console.error(`null ${table}.${col}: ${error.message}`);
}

// Also nuke dependent rows that have ON DELETE CASCADE from profiles
// (audit_log.actor_id is SET NULL, fine). athletes cascade from profiles.

// Delete profiles first (FK -> auth.users is ON DELETE CASCADE anyway,
// but this keeps audit_log / athletes cleanup explicit).
const { error: profErr } = await sb.from("profiles").delete().not("id", "is", null);
if (profErr) {
  console.error("profiles delete error:", profErr.message);
}

let page = 1;
let totalDeleted = 0;
for (;;) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error("listUsers error:", error.message);
    process.exit(1);
  }
  const users = data?.users ?? [];
  if (users.length === 0) break;
  for (const u of users) {
    const { error: delErr } = await sb.auth.admin.deleteUser(u.id);
    if (delErr) {
      console.error(`  del ${u.email}: ${delErr.message}`);
    } else {
      totalDeleted++;
    }
  }
  if (users.length < 200) break;
  page++;
}

console.log(`Deleted ${totalDeleted} auth users.`);

#!/usr/bin/env node
// Challonge auth ping — verifies CHALLONGE_API_KEY + CHALLONGE_USERNAME
// by listing the first page of tournaments on the account.
//
// Usage:
//   cd web
//   node --env-file=.env.local scripts/challonge-ping.mjs <username>
//
// Prints account, count, and first 10 tournament names. Exits non-zero on auth failure.

import { makeClient } from "../src/lib/challonge/client.mjs";

const username = process.argv[2] || process.env.CHALLONGE_USERNAME;
const apiKey = process.env.CHALLONGE_API_KEY;

if (!username) {
  console.error("Pass Challonge username as arg, or set CHALLONGE_USERNAME.");
  process.exit(2);
}
if (!apiKey || apiKey === "PASTE_KEY_HERE") {
  console.error("CHALLONGE_API_KEY missing in env (web/.env.local).");
  process.exit(2);
}

const c = makeClient({ username, apiKey });

try {
  const list = await c.listTournaments({ per_page: 10 });
  const arr = Array.isArray(list) ? list : (list?.tournaments ?? []);
  console.log(`OK — auth as "${username}". Tournaments visible (page 1, max 10): ${arr.length}`);
  for (const item of arr) {
    const t = item.tournament ?? item.attributes ?? item;
    const name = t.name ?? "(unnamed)";
    const url = t.url ?? t.id ?? "";
    const state = t.state ?? "";
    console.log(`  - ${name}  [${state}]  https://challonge.com/${url}`);
  }
} catch (e) {
  console.error(`FAILED ${e.message}`);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
}

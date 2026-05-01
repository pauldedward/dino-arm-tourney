#!/usr/bin/env node
// One-shot: wipe every tournament under the tn-arm-2026 subdomain.
// Usage: node --env-file=.env.local scripts/wipe-challonge.mjs

import { makeClient } from "../src/lib/challonge/client.mjs";

const SUB = "tn-arm-2026";
const c = makeClient({
  username: process.env.CHALLONGE_USERNAME,
  apiKey: process.env.CHALLONGE_API_KEY,
});

let total = 0, ok = 0, fail = 0;
while (true) {
  const list = await c.listTournaments({ subdomain: SUB, per_page: 100 });
  const arr = Array.isArray(list) ? list : (list?.tournaments ?? []);
  if (arr.length === 0) break;
  if (total === 0) console.log("Found", arr.length, "on this page");
  for (const t of arr) {
    const x = t.tournament ?? t;
    const slug = `${SUB}-${x.url}`;
    try {
      await c.deleteTournament(slug);
      ok++; total++;
      if (total % 10 === 0) console.log(" deleted", total, "last:", x.url);
    } catch (e) {
      fail++; total++;
      console.error(" FAIL", x.url, e.status, e.body?.errors?.[0] ?? e.message);
      if (fail > 5) { console.error("Too many failures, aborting"); process.exit(1); }
    }
  }
}
console.log(`Done. ok=${ok} fail=${fail}`);

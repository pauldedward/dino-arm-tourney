#!/usr/bin/env node
/**
 * Mirror every R2 photo into web/public/cached/<registration_id>.jpg so the
 * match-day app keeps working even when offline / R2 is throttled.
 *
 * Usage:  node scripts/cache-photos.mjs [--event <slug>]
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(process.cwd(), "public", "cached");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  await mkdir(ROOT, { recursive: true });
  const supa = createClient(url, key, { auth: { persistSession: false } });

  const argEvent = (() => {
    const i = process.argv.indexOf("--event");
    return i > 0 ? process.argv[i + 1] : null;
  })();

  let q = supa.from("registrations").select("id, photo_url, events!inner(slug)").not("photo_url", "is", null);
  if (argEvent) q = q.eq("events.slug", argEvent);
  const { data, error } = await q;
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  console.log(`Caching ${data.length} photos…`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of data) {
    const dest = path.join(ROOT, `${row.id}.jpg`);
    if (existsSync(dest)) { skipped++; continue; }
    try {
      const res = await fetch(row.photo_url);
      if (!res.ok) { failed++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      ok++;
    } catch {
      failed++;
    }
  }
  console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
}
main();

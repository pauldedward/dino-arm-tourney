#!/usr/bin/env node
/**
 * Offline photo cache for match-day.
 *
 * Downloads every image referenced by the event into `web/public/cached/` so
 * the app can keep working when venue Wi-Fi dies. Covers:
 *   - event.logo_url / banner_url / id_card_signature_url        (public URL)
 *   - registrations.photo_url                                    (private R2 key)
 *   - weigh_ins.live_photo_url / scale_photo_url                 (private R2 key)
 *
 * Usage:   npm run cache:photos -- --event=<uuid>
 *          npm run cache:photos -- --all   (every non-draft event)
 *
 * Idempotent: skips files already present.
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const OUT_DIR = new URL("../public/cached/", import.meta.url);

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return fallback;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
}

function env(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env var: ${k}. Run via 'npm run cache:photos'.`);
    process.exit(1);
  }
  return v;
}

function supabase() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function r2() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    },
  });
}

function outPath(name) {
  return new URL(name.replace(/[^a-zA-Z0-9._-]/g, "_"), OUT_DIR);
}

async function downloadPublic(url, name, stats) {
  const dest = outPath(name);
  if (existsSync(dest)) {
    stats.skipped += 1;
    return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    stats.downloaded += 1;
    stats.bytes += buf.byteLength;
  } catch (err) {
    console.warn(`  ! public ${name}: ${err.message}`);
    stats.failed += 1;
  }
}

async function downloadPrivate(client, bucket, key, stats) {
  const name = key.replace(/\//g, "__");
  const dest = outPath(name);
  if (existsSync(dest)) {
    stats.skipped += 1;
    return;
  }
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const buf = Buffer.from(await res.Body.transformToByteArray());
    writeFileSync(dest, buf);
    stats.downloaded += 1;
    stats.bytes += buf.byteLength;
  } catch (err) {
    console.warn(`  ! private ${key}: ${err.message}`);
    stats.failed += 1;
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const sb = supabase();
  const s3 = r2();
  const privateBucket = env("R2_PRIVATE_BUCKET");

  const eventArg = arg("event");
  const all = arg("all");
  if (!eventArg && !all) {
    console.error("Usage: npm run cache:photos -- --event=<uuid> | --all");
    process.exit(1);
  }

  const eventQuery = sb
    .from("events")
    .select("id, name, status, logo_url, banner_url, id_card_signature_url");
  const { data: events, error } = all
    ? await eventQuery.neq("status", "draft")
    : await eventQuery.eq("id", eventArg);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!events?.length) {
    console.log("No events matched.");
    return;
  }

  const stats = { downloaded: 0, skipped: 0, failed: 0, bytes: 0 };

  for (const ev of events) {
    console.log(`\n== ${ev.name} (${ev.id}) ==`);

    for (const url of [ev.logo_url, ev.banner_url, ev.id_card_signature_url]) {
      if (!url) continue;
      const name = `event-${ev.id}-${url.split("/").pop()}`;
      await downloadPublic(url, name, stats);
    }

    const { data: regs } = await sb
      .from("registrations")
      .select("id, photo_url")
      .eq("event_id", ev.id)
      .not("photo_url", "is", null);
    for (const r of regs ?? []) {
      await downloadPrivate(s3, privateBucket, r.photo_url, stats);
    }

    const { data: regIdsRows } = await sb
      .from("registrations")
      .select("id")
      .eq("event_id", ev.id);
    const regIds = (regIdsRows ?? []).map((r) => r.id);
    if (regIds.length) {
      const { data: wis } = await sb
        .from("weigh_ins")
        .select("live_photo_url, scale_photo_url")
        .in("registration_id", regIds);
      for (const w of wis ?? []) {
        if (w.live_photo_url)
          await downloadPrivate(s3, privateBucket, w.live_photo_url, stats);
        if (w.scale_photo_url)
          await downloadPrivate(s3, privateBucket, w.scale_photo_url, stats);
      }
    }
  }

  const mb = (stats.bytes / (1024 * 1024)).toFixed(2);
  console.log(
    `\nDone. downloaded=${stats.downloaded} skipped=${stats.skipped} failed=${stats.failed} size=${mb} MB`
  );
  console.log(`Output: ${join(OUT_DIR.pathname.slice(1))}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

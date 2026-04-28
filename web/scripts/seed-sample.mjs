#!/usr/bin/env node
/**
 * Sample-data seeder for Dino Arm Tourney.
 *
 * Usage:
 *   npm run seed:sample       - upserts sample org, events, and registrations.
 *   npm run seed:reset        - deletes sample rows by their stable prefix.
 *
 * Idempotent: every sample row uses a UUID prefixed with
 * `00000000-0000-0000-0000-000000000000` (the leading 20 zero-hex chars) so
 * reset can target them without touching real rows.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SAMPLE_PREFIX = "20000000-0000-0000-0000-";
const SEED_DIR = new URL("../seed/sample/", import.meta.url);

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    console.error("Run via 'npm run seed:sample' so .env.local is loaded.");
    process.exit(1);
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function loadJson(file) {
  return JSON.parse(readFileSync(new URL(file, SEED_DIR), "utf8"));
}

async function resetSamples(supabase) {
  console.log("reset: deleting sample rows (uuid prefix " + SAMPLE_PREFIX + ")");
  // Order matters for FK integrity.
  const tables = [
    "payments",
    "weigh_ins",
    "entries",
    "fixtures",
    "registrations",
    "events",
    "organizations",
  ];
  for (const t of tables) {
    const { error, count } = await supabase
      .from(t)
      .delete({ count: "exact" })
      .like("id", SAMPLE_PREFIX + "%");
    if (error) {
      console.warn(`  ${t}: ${error.message}`);
    } else {
      console.log(`  ${t}: ${count ?? 0} deleted`);
    }
  }
}

async function upsertSamples(supabase) {
  const events = loadJson("events.json");
  const regs = loadJson("registrations.json");

  // 1. Organisation — reuse existing row by slug if present, else insert.
  const org = events.organization;
  let orgId;
  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", org.slug)
    .maybeSingle();
  if (existingOrg) {
    orgId = existingOrg.id;
    console.log("org: " + org.slug + " (existing " + orgId + ")");
  } else {
    const { data: inserted, error: orgErr } = await supabase
      .from("organizations")
      .insert(org)
      .select("id")
      .single();
    if (orgErr) throw orgErr;
    orgId = inserted.id;
    console.log("org: " + org.slug + " (created " + orgId + ")");
  }

  // 2. Events — strip id if the slug already exists (so we don't try to
  //    change the primary key of a referenced row).
  const { data: existingEvents } = await supabase
    .from("events")
    .select("id, slug")
    .in(
      "slug",
      events.events.map((e) => e.slug)
    );
  const slugToId = new Map((existingEvents ?? []).map((r) => [r.slug, r.id]));

  const eventRows = events.events.map((e) => {
    const existingId = slugToId.get(e.slug);
    const { id: _fixtureId, ...rest } = e;
    return {
      id: existingId ?? e.id,
      payment_provider: "manual_upi",
      ...rest,
      organization_id: orgId,
    };
  });
  const { error: evErr } = await supabase
    .from("events")
    .upsert(eventRows, { onConflict: "id" });
  if (evErr) throw evErr;
  console.log("events: " + eventRows.length + " upserted");

  // Remap the sample registrations' event_id in case an existing event id
  // is different from the fixture's desired one.
  const targetEventSlug = events.events[0].slug;
  const resolvedEventId = slugToId.get(targetEventSlug) ?? events.events[0].id;

  // 3. Registrations. athlete_id is nullable in 0001; public registration
  //    (the Week-1 primary flow) doesn't require an auth user.
  const regRows = regs.registrations.map((r) => ({
    id: r.id,
    event_id: resolvedEventId,
    athlete_id: null,
    weight_class_code: r.division === "Women" || r.division === "Para Women"
      ? "SW-OPN"
      : "SM-OPN",
    hand:
      r.senior_hand === "L" || r.youth_hand === "L" ? "left" : "right",
    status:
      r.status === "weighed_in"
        ? "weighed_in"
        : r.status === "paid"
          ? "paid"
          : "pending",
    chest_no: r.chest_no,
    initial: r.initial,
    full_name: r.full_name,
    dob: r.dob,
    division: r.division,
    affiliation_kind: "District",
    district: r.district,
    mobile: r.mobile,
    declared_weight_kg: r.declared_weight_kg,
    age_categories: r.age_categories,
    youth_hand: r.youth_hand ?? null,
    senior_hand: r.senior_hand ?? null,
    submitted_by: "seed",
  }));

  const { error: regErr } = await supabase
    .from("registrations")
    .upsert(regRows, { onConflict: "id" });
  if (regErr) throw regErr;
  console.log("registrations: " + regRows.length + " upserted");

  // Athletes table: also seed para details for Para registrations so the
  // weigh-in UI has something to render.
  const paraAthletes = regs.registrations
    .filter((r) => r.is_para)
    .map((r) => ({
      id: r.id, // reuse registration id as athlete id for sample rows
      is_para: true,
      para_class: r.para_class,
      para_posture: r.para_posture,
      date_of_birth: r.dob,
      gender: r.division.includes("Women") ? "F" : "M",
      state: "Tamil Nadu",
      district: r.district,
    }));
  // athletes.id FKs profiles.id which FKs auth.users. So these won't insert
  // without a real auth user. Skip silently — the Para flags are already on
  // registrations anyway.
  if (paraAthletes.length > 0) {
    console.log("  (skipping " + paraAthletes.length + " para-athlete rows — require auth users)");
  }

  // 4. Payments
  const payRows = regs.registrations.map((r, i) => ({
    id: `20000000-0000-0000-0000-0000000002${r.chest_no.toString().padStart(2, "0")}`,
    registration_id: r.id,
    amount_inr: 500,
    method: "manual_upi",
    utr:
      r.status === "pending"
        ? null
        : `UTR${r.chest_no.toString().padStart(10, "0")}`,
    status: r.status === "pending" ? "pending" : "verified",
    verified_at: r.status === "pending" ? null : new Date().toISOString(),
  }));
  const { error: payErr } = await supabase
    .from("payments")
    .upsert(payRows, { onConflict: "id" });
  if (payErr) console.warn("payments: " + payErr.message);
  else console.log("payments: " + payRows.length + " upserted");
}

async function main() {
  const args = process.argv.slice(2);
  const supabase = serviceClient();
  if (args.includes("--reset")) {
    await resetSamples(supabase);
    return;
  }
  await upsertSamples(supabase);
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

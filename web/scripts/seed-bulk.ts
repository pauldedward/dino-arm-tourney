#!/usr/bin/env node
/**
 * Bracket-populating bulk seeder.
 *
 * The hand-written `registrations.json` has 20 athletes, each landing in a
 * unique (division × age × weight × hand) bucket — producing 0 real
 * brackets. This script adds ~50 more athletes deterministically clustered
 * into standard WAF weight classes so the rehearsal produces brackets of
 * 4-8 per category.
 *
 * Idempotent: stable UUIDs `20000000-0000-0000-0000-0000000002XX` where XX
 * is the chest_no. Re-running upserts on id.
 *
 * Usage:   npm run seed:bulk
 *          npm run seed:bulk -- --reset   (delete just the bulk rows)
 */

import { createClient } from "@supabase/supabase-js";

const EVENT_ID = "20000000-0000-0000-0000-000000000001";
const ID_PREFIX = "20000000-0000-0000-0000-000000002"; // + 3-digit chest

const TN_DISTRICTS = [
  "Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem",
  "Vellore", "Tirunelveli", "Erode", "Thanjavur", "Tiruppur",
  "Dindigul", "Kanyakumari", "Nilgiris", "Thoothukudi", "Karur",
  "Namakkal", "Krishnagiri", "Cuddalore", "Sivaganga", "Ramanathapuram",
];

// Each cluster targets ONE (division, age_band, weight_class, hand) bucket.
// `count` athletes with weights just under `upperKg` and matching hand are
// generated. Paid + pending + weighed_in statuses are distributed 3:1:4.
type Cluster = {
  count: number;
  division: "Men" | "Women" | "Para Men" | "Para Women";
  ageBand: "U14" | "U16" | "U18" | "U21" | "SENIOR" | "M40" | "M50";
  upperKg: number | null; // target weight ceiling
  hand: "R" | "L";
  isPara?: boolean;
  paraClass?: string;
};

const CLUSTERS: Cluster[] = [
  // Senior Men — the heavy end of the typical entry list.
  { count: 8, division: "Men", ageBand: "SENIOR", upperKg: 70, hand: "R" },
  { count: 6, division: "Men", ageBand: "SENIOR", upperKg: 80, hand: "R" },
  { count: 4, division: "Men", ageBand: "SENIOR", upperKg: 90, hand: "R" },
  { count: 4, division: "Men", ageBand: "SENIOR", upperKg: 100, hand: "R" },
  { count: 4, division: "Men", ageBand: "SENIOR", upperKg: 70, hand: "L" },
  // Senior Women
  { count: 4, division: "Women", ageBand: "SENIOR", upperKg: 60, hand: "R" },
  { count: 4, division: "Women", ageBand: "SENIOR", upperKg: 70, hand: "R" },
  // Youth
  { count: 8, division: "Men", ageBand: "U18", upperKg: 70, hand: "R" },
  { count: 4, division: "Women", ageBand: "U16", upperKg: 55, hand: "R" },
  // Para
  { count: 4, division: "Para Men", ageBand: "SENIOR", upperKg: 80, hand: "R",
    isPara: true, paraClass: "PD2" },
];

function env(k: string): string {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env: ${k}. Run via 'npm run seed:bulk'.`);
    process.exit(1);
  }
  return v;
}

function dobForBand(
  band: Cluster["ageBand"],
  refYear: number,
  i: number
): string {
  const age =
    band === "U14" ? 13 :
    band === "U16" ? 15 :
    band === "U18" ? 17 :
    band === "U21" ? 20 :
    band === "M40" ? 42 + (i % 5) :
    band === "M50" ? 52 + (i % 5) :
    22 + (i % 15); // SENIOR: 22-36
  const y = refYear - age;
  const m = ((i * 7) % 12) + 1;
  const d = ((i * 13) % 28) + 1;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type Row = {
  id: string;
  event_id: string;
  athlete_id: null;
  chest_no: number;
  full_name: string;
  initial: string;
  dob: string;
  division: Cluster["division"];
  affiliation_kind: "District";
  district: string;
  mobile: string;
  declared_weight_kg: number;
  age_categories: string[];
  youth_hand: "R" | "L" | null;
  senior_hand: "R" | "L" | null;
  weight_class_code: string;
  hand: "left" | "right";
  status: "pending" | "paid" | "weighed_in";
  submitted_by: "bulk-seed";
};

function buildRows(refYear: number): Row[] {
  const rows: Row[] = [];
  let chest = 200; // bulk chest numbers start at 201
  for (const c of CLUSTERS) {
    for (let i = 0; i < c.count; i++) {
      chest += 1;
      const weight =
        c.upperKg == null
          ? 115 + ((chest % 20))
          : Math.max(25, c.upperKg - 0.5 - (i % 4) * 1.3);
      const isYouth = ["U14", "U16", "U18", "U21"].includes(c.ageBand);
      const status: Row["status"] =
        i % 8 === 0 ? "pending" :
        i % 3 === 0 ? "weighed_in" : "paid";
      const divCode = c.division.includes("Women") ? "SW" : "SM";
      const yDivCode = c.division.includes("Women") ? "YW" : "YM";
      const classCode = isYouth
        ? `${yDivCode}-${c.upperKg ?? "OPN"}`
        : `${divCode}-${c.upperKg ?? "OPN"}`;
      const idx = chest - 200; // 1-based
      rows.push({
        id: `${ID_PREFIX}${String(chest).padStart(3, "0")}`,
        event_id: EVENT_ID,
        athlete_id: null,
        chest_no: chest,
        full_name: nameFor(idx, c.division),
        initial: String.fromCharCode(65 + (idx % 26)),
        dob: dobForBand(c.ageBand, refYear, idx),
        division: c.division,
        affiliation_kind: "District",
        district: TN_DISTRICTS[idx % TN_DISTRICTS.length],
        mobile: `98765${String(10000 + chest).slice(-5)}`,
        declared_weight_kg: Number(weight.toFixed(1)),
        age_categories: [c.ageBand],
        youth_hand: isYouth ? c.hand : null,
        senior_hand: !isYouth ? c.hand : null,
        weight_class_code: classCode,
        hand: c.hand === "L" ? "left" : "right",
        status,
        submitted_by: "bulk-seed",
      });
    }
  }
  return rows;
}

function nameFor(idx: number, division: Cluster["division"]): string {
  const m = [
    "Arjun", "Karthik", "Suresh", "Ramesh", "Muthu", "Vijay", "Senthil",
    "Bala", "Gopi", "Sathish", "Ravi", "Mohan", "Pradeep", "Anand",
    "Rajesh", "Dinesh", "Naveen", "Kumar", "Velu", "Ganesh",
  ];
  const f = [
    "Priya", "Meena", "Divya", "Lakshmi", "Kavya", "Indira", "Shanti",
    "Geetha", "Uma", "Anitha", "Revathi", "Nandhini", "Deepa", "Swathi",
  ];
  const pool = division.includes("Women") ? f : m;
  const first = pool[idx % pool.length];
  const surs = ["Kumar", "Raja", "Prasad", "Velan", "Selvam", "Krishnan", "Anand"];
  const sur = surs[idx % surs.length];
  return `${first} ${sur}`;
}

async function main() {
  const sb = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  if (process.argv.includes("--reset")) {
    const { count, error } = await sb
      .from("registrations")
      .delete({ count: "exact" })
      .like("id", `${ID_PREFIX}%`)
      .eq("event_id", EVENT_ID);
    if (error) throw error;
    console.log(`reset: deleted ${count ?? 0} bulk registrations`);
    return;
  }

  // Confirm the event exists.
  const { data: event } = await sb
    .from("events")
    .select("id, starts_at")
    .eq("id", EVENT_ID)
    .maybeSingle();
  if (!event) {
    console.error(`Event ${EVENT_ID} not found. Run 'npm run seed:sample' first.`);
    process.exit(1);
  }

  const refYear = event.starts_at
    ? new Date(event.starts_at).getUTCFullYear()
    : new Date().getUTCFullYear();
  const rows = buildRows(refYear);

  // Upsert in chunks of 50.
  let done = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await sb
      .from("registrations")
      .upsert(chunk, { onConflict: "id" });
    if (error) throw error;
    done += chunk.length;
  }
  console.log(`bulk: upserted ${done} registrations across ${CLUSTERS.length} clusters`);

  // Also write a 'verified' payment row for every non-pending reg so the
  // fixture flow has eligible athletes.
  const payRows = rows
    .filter((r) => r.status !== "pending")
    .map((r) => ({
      id: `20000000-0000-0000-0000-000000003${String(r.chest_no).padStart(3, "0")}`,
      registration_id: r.id,
      amount_inr: 500,
      method: "manual_upi",
      utr: `UTR${String(r.chest_no).padStart(10, "0")}`,
      status: "verified",
      verified_at: new Date().toISOString(),
    }));
  if (payRows.length) {
    const { error } = await sb
      .from("payments")
      .upsert(payRows, { onConflict: "id" });
    if (error) console.warn(`payments warn: ${error.message}`);
    else console.log(`bulk: upserted ${payRows.length} payments`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

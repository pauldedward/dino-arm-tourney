/* eslint-disable no-console */
/**
 * Sample-data seeder.
 *
 * Loads JSON fixtures from web/seed/sample/ into the real Supabase Postgres
 * via the service-role key. JSON is the source for the seeder; it is NOT
 * the runtime store. (See PLAN-WEEK1.md §1.5.)
 *
 * Usage:
 *   node scripts/seed-sample.mjs           # idempotent upsert
 *   node scripts/seed-sample.mjs --reset   # delete all sample-flagged rows then reseed
 *
 * Required env (loaded from web/.env.local automatically):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadEnv({ path: resolve(root, ".env.local") });
loadEnv({ path: resolve(root, ".env") });

const RESET = process.argv.includes("--reset");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supa = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loadJson(name) {
  const p = resolve(root, "seed", "sample", `${name}.json`);
  return JSON.parse(await readFile(p, "utf8"));
}

async function ensureAuthUser({ id, email, password, full_name }) {
  // 1. Try the desired id first.
  const { data: byId } = await supa.auth.admin.getUserById(id);
  if (byId?.user) return byId.user;

  // 2. Email might already be claimed under a different id (from a prior
  //    failed run). Find it and delete so we can recreate with the desired id.
  const { data: list } = await supa.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existingByEmail = list?.users?.find((u) => u.email === email);
  if (existingByEmail && existingByEmail.id !== id) {
    await supa.auth.admin.deleteUser(existingByEmail.id);
  }

  const { data, error } = await supa.auth.admin.createUser({
    id,
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user;
}

async function main() {
  const orgs = await loadJson("organizations");
  const users = await loadJson("users");
  const events = await loadJson("events");
  const regs = await loadJson("registrations");
  const pays = await loadJson("payments");
  const weighs = await loadJson("weigh_ins");

  if (RESET) {
    console.log("→ resetting sample rows…");
    await supa.from("weigh_ins").delete().in("id", weighs.map((w) => w.id));
    await supa.from("payments").delete().in("id", pays.map((p) => p.id));
    await supa.from("registrations").delete().in("id", regs.map((r) => r.id));
    await supa.from("events").delete().in("id", events.map((e) => e.id));
    await supa.from("profiles").delete().in("id", users.map((u) => u.id));
    await supa.from("organizations").delete().in("id", orgs.map((o) => o.id));
    for (const u of users) {
      await supa.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }

  console.log("→ organizations");
  const { error: oErr } = await supa
    .from("organizations")
    .upsert(orgs, { onConflict: "id" });
  if (oErr) throw oErr;

  console.log("→ users (auth + profiles)");
  for (const u of users) {
    await ensureAuthUser(u);
    const { error } = await supa.from("profiles").upsert(
      {
        id: u.id,
        full_name: u.full_name,
        phone: u.phone ?? null,
        email: u.email,
        role: u.role,
      },
      { onConflict: "id" }
    );
    if (error) throw new Error(`profiles ${u.email}: ${error.message}`);
  }

  console.log("→ events");
  const { error: eErr } = await supa
    .from("events")
    .upsert(events, { onConflict: "id" });
  if (eErr) throw eErr;

  console.log("→ registrations");
  // Map sample fields to schema (athlete_id stays null for sample rows).
  const regsToInsert = regs.map((r) => ({
    ...r,
    athlete_id: null,
    weight_class_code:
      r.is_para
        ? r.division === "Para Men"
          ? "PM-80"
          : "PW-60"
        : r.gender === "M"
        ? "M-80"
        : "W-65",
    hand:
      r.senior_hand === "L" || r.youth_hand === "L"
        ? "left"
        : r.senior_hand === "B" || r.youth_hand === "B"
        ? "both"
        : "right",
    paid_amount_inr: 500,
  }));
  const { error: rErr } = await supa
    .from("registrations")
    .upsert(regsToInsert, { onConflict: "id" });
  if (rErr) throw rErr;

  console.log("→ payments");
  const { error: pErr } = await supa
    .from("payments")
    .upsert(pays, { onConflict: "id" });
  if (pErr) throw pErr;

  console.log("→ weigh_ins");
  const { error: wErr } = await supa
    .from("weigh_ins")
    .upsert(weighs, { onConflict: "id" });
  if (wErr) throw wErr;

  console.log("✓ seed complete");
  console.log("");
  console.log("Sample super-admin login:");
  console.log("  email:    superadmin@dino.local");
  console.log("  password: Dino@2026!");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

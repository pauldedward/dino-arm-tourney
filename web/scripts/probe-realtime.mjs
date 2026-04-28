/**
 * Realtime smoke test — runs against the live Supabase project.
 * Subscribes anon-side to `events` changes, then service-role does a
 * harmless UPDATE that touches the same row and reverts it.
 *
 * Usage:
 *   node scripts/probe-realtime.mjs
 *
 * Pass criteria: at least one postgres_changes payload is received
 * within 8s of the UPDATE.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Inline .env.local loader to avoid dotenv dep.
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !ANON || !SERVICE) {
  console.error("Missing env (NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE_KEY)");
  process.exit(2);
}

const anon = createClient(SB_URL, ANON);
const svc = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

// Pick any event row to poke.
const { data: ev, error: eErr } = await svc
  .from("events")
  .select("id, name")
  .limit(1)
  .maybeSingle();
if (eErr || !ev) {
  console.error("Need at least one event row:", eErr);
  process.exit(2);
}
console.log(`[probe] using event ${ev.id} "${ev.name}"`);

const tables = ["events", "registrations", "payments", "weigh_ins"];
const received = new Set();

const channel = anon.channel(`probe:${Date.now()}`);
for (const t of tables) {
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: t },
    (p) => {
      received.add(t);
      console.log(`[probe] <- ${t} ${p.eventType}`);
    }
  );
}

await new Promise((resolve, reject) => {
  channel.subscribe((status, err) => {
    console.log(`[probe] channel status: ${status}`);
    if (status === "SUBSCRIBED") resolve();
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(err ?? new Error(status));
  });
});

// Touch the events row (revert immediately so nothing real changes).
const original = ev.name;
const poke = `${original}__probe_${Date.now()}`;
console.log("[probe] -> updating events.name");
await svc.from("events").update({ name: poke }).eq("id", ev.id);
await new Promise((r) => setTimeout(r, 800));
await svc.from("events").update({ name: original }).eq("id", ev.id);

await new Promise((r) => setTimeout(r, 7000));

console.log(`[probe] tables that fired: ${[...received].join(", ") || "(none)"}`);
await anon.removeChannel(channel);
process.exit(received.has("events") ? 0 : 1);

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const tables = [
  "organizations",
  "events",
  "registrations",
  "payments",
  "weigh_ins",
  "audit_log",
  "profiles",
  "athletes",
  "entries",
  "fixtures",
];
for (const t of tables) {
  const r = await s.from(t).select("*", { count: "exact", head: true });
  console.log(
    t.padEnd(16),
    r.error ? "ERR " + r.error.code + " " + r.error.message : "OK count=" + r.count
  );
}

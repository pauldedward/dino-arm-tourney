import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SLUG = "dino-pilot";
const { data: org, error: e1 } = await s.from("organizations").select("id,slug,name").eq("slug", SLUG).maybeSingle();
if (e1) { console.error(e1); process.exit(1); }
if (!org) { console.log("no org with slug", SLUG); process.exit(0); }

const { data: evs } = await s.from("events").select("id,slug,name").eq("organization_id", org.id);
console.log("about to cascade-delete org", org, "and events:", evs);

const { error: eDel, count } = await s.from("organizations").delete({ count: "exact" }).eq("id", org.id);
if (eDel) { console.error(eDel); process.exit(1); }
console.log("deleted organizations:", count);

const { data: after } = await s.from("organizations").select("id,slug,name,kind,region").order("name");
console.table(after);
for (const o of after) {
  const { count: ec } = await s.from("events").select("id", { count: "exact", head: true }).eq("organization_id", o.id);
  console.log(o.slug, "->", ec, "events");
}

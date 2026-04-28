import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await s.from("organizations").select("id,slug,name,kind,region").order("name");
if (error) { console.error(error); process.exit(1); }
console.table(data);

// also count events per org
for (const o of data) {
  const { count } = await s.from("events").select("id", { count: "exact", head: true }).eq("organization_id", o.id);
  console.log(o.slug, "->", count, "events");
}

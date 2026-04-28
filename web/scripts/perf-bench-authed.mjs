#!/usr/bin/env node
// Authed perf bench using @supabase/ssr to capture real cookie shape.
import { performance } from "node:perf_hooks";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.argv[2] || "http://localhost:3001";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;

function pct(a,p){const s=[...a].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(s.length*p/100))];}
function summary(name, samples) {
  const min = Math.min(...samples).toFixed(0);
  const med = pct(samples,50).toFixed(0);
  const p95 = pct(samples,95).toFixed(0);
  const max = Math.max(...samples).toFixed(0);
  const avg = (samples.reduce((a,b)=>a+b,0)/samples.length).toFixed(0);
  console.log(`${name.padEnd(54)} n=${samples.length} min=${min}ms med=${med}ms p95=${p95}ms max=${max}ms avg=${avg}ms`);
}

async function main() {
  console.log(`Origin: ${ORIGIN}\n`);
  const svc = createClient(SUPA, SVC, { auth: { autoRefreshToken:false, persistSession:false }});

  const email = "perf-bench@dino.local";
  const password = "perfbench-secret-1234";
  const { data: existing } = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
  let userId = existing?.id;
  if (!userId) {
    const { data: cr, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = cr.user.id;
  } else {
    await svc.auth.admin.updateUserById(userId, { password, email_confirm: true });
  }
  await svc.from("profiles").upsert({ id: userId, email, role: "super_admin", full_name: "Perf Bench", disabled_at: null });

  const jar = new Map();
  const ssr = createServerClient(SUPA, ANON, {
    cookies: {
      getAll() { return [...jar.entries()].map(([name,value])=>({ name, value })); },
      setAll(list) { for (const c of list) jar.set(c.name, c.value); },
    },
  });
  const { error } = await ssr.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await ssr.auth.getUser();

  if (jar.size === 0) throw new Error("no cookies captured");
  const cookieHeader = [...jar.entries()].map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join("; ");
  console.log("captured cookies:", [...jar.keys()].join(", "));

  const probe = await fetch(`${ORIGIN}/admin/events`, { headers:{cookie:cookieHeader}, redirect:"manual" });
  console.log(`probe /admin/events: status=${probe.status}\n`);

  async function hit(path, n=8) {
    const out = [];
    try { await fetch(`${ORIGIN}${path}`, { headers:{cookie:cookieHeader}, redirect:"manual" }).then(r=>r.arrayBuffer()); } catch {}
    for (let i=0;i<n;i++) {
      const t = performance.now();
      const r = await fetch(`${ORIGIN}${path}`, { headers:{cookie:cookieHeader}, redirect:"manual" });
      await r.arrayBuffer();
      out.push(performance.now()-t);
    }
    return out;
  }

  const { data: ev } = await svc.from("events").select("id,slug").limit(1).maybeSingle();
  const slug = ev?.slug;
  console.log(`Using event slug: ${slug}\n`);

  console.log("# Authed admin pages");
  summary("GET /admin/events", await hit("/admin/events"));
  if (slug) summary(`GET /admin/events/${slug}`, await hit(`/admin/events/${slug}`));
  if (slug) summary(`GET /admin/events/${slug}/registrations`, await hit(`/admin/events/${slug}/registrations`));
  if (slug) summary(`GET /admin/events/${slug}/weighin`, await hit(`/admin/events/${slug}/weighin`));
  summary("GET /admin/users", await hit("/admin/users"));
  summary("GET /admin/audit", await hit("/admin/audit"));

  console.log("\n# Admin API");
  if (ev?.id) summary(`GET /api/admin/registrations?event_id=...`, await hit(`/api/admin/registrations?event_id=${ev.id}&pageSize=100`));
}
main().catch(e => { console.error(e); process.exit(1); });

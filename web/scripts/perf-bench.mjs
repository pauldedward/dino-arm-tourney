#!/usr/bin/env node
// Perf benchmark — proves where page time goes.
// Run: node --env-file=.env.local scripts/perf-bench.mjs [origin]
import { performance } from "node:perf_hooks";

const ORIGIN = process.argv[2] || "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPA || !ANON || !SVC) { console.error("missing env"); process.exit(1); }

function pct(arr, p) {
  const s = [...arr].sort((a,b)=>a-b);
  return s[Math.min(s.length-1, Math.floor(s.length*p/100))];
}
function summary(name, samples) {
  const min = Math.min(...samples).toFixed(0);
  const med = pct(samples, 50).toFixed(0);
  const p95 = pct(samples, 95).toFixed(0);
  const max = Math.max(...samples).toFixed(0);
  const avg = (samples.reduce((a,b)=>a+b,0)/samples.length).toFixed(0);
  console.log(`${name.padEnd(46)} n=${samples.length} min=${min}ms med=${med}ms p95=${p95}ms max=${max}ms avg=${avg}ms`);
}

async function time(fn, n=8) {
  const out = [];
  // warm
  try { await fn(); } catch {}
  for (let i=0;i<n;i++) {
    const t = performance.now();
    try { await fn(); } catch {}
    out.push(performance.now()-t);
  }
  return out;
}

async function main() {
  console.log(`Origin: ${ORIGIN}`);
  console.log(`Supabase: ${SUPA}`);
  console.log(`Node ${process.version}\n`);

  // --- 1. Pure Supabase REST latency (no Next.js) ---
  console.log("# 1. Supabase REST latency (direct, no Next)");

  // a) auth.getUser equivalent — calls /auth/v1/user with no token (still hits server)
  summary("supabase /auth/v1/user (no jwt)", await time(async () => {
    await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }});
  }));

  // b) tiny SELECT via REST (anon, RLS may block but we measure RTT)
  summary("supabase events SELECT 1 col anon", await time(async () => {
    await fetch(`${SUPA}/rest/v1/events?select=id&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }});
  }));

  // c) tiny SELECT via service role
  summary("supabase events SELECT * limit 1 svc", await time(async () => {
    await fetch(`${SUPA}/rest/v1/events?select=*&limit=1`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }});
  }));

  // d) profiles single by id (typical requireRole probe)
  summary("supabase profiles select role", await time(async () => {
    await fetch(`${SUPA}/rest/v1/profiles?select=role,disabled_at&limit=1`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }});
  }));

  // e) registrations join payments (the heavy listing)
  summary("registrations + payments join, limit 100", await time(async () => {
    await fetch(`${SUPA}/rest/v1/registrations?select=id,chest_no,full_name,division,status,payments(id,status,utr)&limit=100`, {
      headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Prefer: "count=estimated" }
    });
  }, 6));

  // f) parallel: simulate event detail (events + 3 counts)
  summary("event detail set (events + 3 counts) PARALLEL", await time(async () => {
    const evRes = await fetch(`${SUPA}/rest/v1/events?select=*&limit=1`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }});
    const ev = (await evRes.json())[0];
    if (!ev) return;
    await Promise.all([
      fetch(`${SUPA}/rest/v1/registrations?event_id=eq.${ev.id}&select=id`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Prefer: "count=exact", Range: "0-0" }}),
      fetch(`${SUPA}/rest/v1/payments?event_id=eq.${ev.id}&status=eq.pending&select=id`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Prefer: "count=exact", Range: "0-0" }}),
      fetch(`${SUPA}/rest/v1/payments?event_id=eq.${ev.id}&status=eq.verified&select=id`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Prefer: "count=exact", Range: "0-0" }}),
    ]);
  }, 6));

  // g) sequential variant — what page would do if not parallel
  summary("event detail set SEQUENTIAL (4 RTTs)", await time(async () => {
    const evRes = await fetch(`${SUPA}/rest/v1/events?select=*&limit=1`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }});
    const ev = (await evRes.json())[0];
    if (!ev) return;
    await fetch(`${SUPA}/rest/v1/registrations?event_id=eq.${ev.id}&select=id`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Prefer: "count=exact", Range: "0-0" }});
    await fetch(`${SUPA}/rest/v1/payments?event_id=eq.${ev.id}&status=eq.pending&select=id`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Prefer: "count=exact", Range: "0-0" }});
    await fetch(`${SUPA}/rest/v1/payments?event_id=eq.${ev.id}&status=eq.verified&select=id`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, Prefer: "count=exact", Range: "0-0" }});
  }, 6));

  // --- 2. Next.js page TTFB ---
  console.log("\n# 2. Next.js page TTFB (server-rendered)");

  // figure out a usable event slug
  let slug = null;
  try {
    const r = await fetch(`${SUPA}/rest/v1/events?select=slug,status&limit=5`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }});
    const arr = await r.json();
    slug = (arr.find(e => e.status !== "draft") ?? arr[0])?.slug ?? null;
  } catch {}
  console.log(`(using event slug: ${slug ?? "<none>"})`);

  async function hit(path, n=6) {
    return time(async () => {
      const t = performance.now();
      const res = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
      // drain body so timing is honest
      await res.arrayBuffer();
      return performance.now()-t;
    }, n);
  }

  summary("GET /", await hit("/", 8));
  summary("GET /login", await hit("/login", 8));
  if (slug) summary(`GET /e/${slug}`, await hit(`/e/${slug}`, 8));
  if (slug) summary(`GET /e/${slug}/register`, await hit(`/e/${slug}/register`, 8));

  // admin needs auth; should redirect to /login fast
  summary("GET /admin (unauth → 307)", await hit("/admin", 8));
  summary("GET /admin/events (unauth)", await hit("/admin/events", 8));
}
main().catch(e => { console.error(e); process.exit(1); });

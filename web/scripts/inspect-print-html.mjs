import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const EMAIL = "perf-bench@dino.local";
const PASSWORD = "perfbench-secret-1234";

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await svc.from("events").select("slug,registrations(id)").limit(40);
const slug = data.map((e) => ({ ...e, n: (e.registrations ?? []).length })).sort((a, b) => b.n - a.n)[0].slug;

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1024, height: 768 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/login");
await p.fill('input[type="email"]', EMAIL);
await p.fill('input[type="password"]', PASSWORD);
await Promise.all([p.waitForURL((u) => !u.pathname.includes("/login")), p.click('button[type="submit"]')]);
await p.goto(`http://localhost:3000/admin/events/${slug}/print`, { waitUntil: "networkidle" });
const cards = await p.$$eval("p.font-display", (els) =>
  els.map((e) => {
    const t = e.textContent || "";
    const cps = [...t].map((c) => c.codePointAt(0).toString(16));
    return { text: t, codepoints: cps };
  }),
);
console.log(JSON.stringify(cards, null, 2));
await b.close();

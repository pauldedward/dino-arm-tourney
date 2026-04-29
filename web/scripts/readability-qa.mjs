#!/usr/bin/env node
/**
 * Visual QA sweep for the readability bump.
 *
 * Logs in as the perf-bench super_admin, picks the event with the most
 * registrations, then screenshots the 5 operator surfaces at 1440x900
 * AND 1024x768. Captures any console errors. Detects horizontal
 * overflow on each page (== "ugliness / clutter signal").
 *
 * Run:
 *   cd web
 *   node --env-file=.env.local scripts/readability-qa.mjs [origin]
 *
 * Requires Playwright (uses `npx playwright`'s bundled chromium).
 *
 * Output: research/rehearsal-out/readability-qa/<surface>-<width>.png
 *         + a stdout report grouped by surface.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.argv[2] || "http://localhost:3000";
const OUT_DIR = resolve(process.cwd(), "..", "research", "rehearsal-out", "readability-qa");
const EMAIL = "perf-bench@dino.local";
const PASSWORD = "perfbench-secret-1234";

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
];

async function ensureUser() {
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: existing } = await svc.from("profiles").select("id").eq("email", EMAIL).maybeSingle();
  let uid = existing?.id;
  if (!uid) {
    const { data, error } = await svc.auth.admin.createUser({
      email: EMAIL, password: PASSWORD, email_confirm: true,
    });
    if (error) throw error;
    uid = data.user.id;
  } else {
    await svc.auth.admin.updateUserById(uid, { password: PASSWORD, email_confirm: true });
  }
  await svc.from("profiles").upsert({
    id: uid, email: EMAIL, role: "super_admin", full_name: "QA Bot", disabled_at: null,
  });

  // Pick event with most registrations.
  const { data: events } = await svc
    .from("events")
    .select("id,slug,name,registrations(id)")
    .limit(40);
  const best = (events ?? [])
    .map((e) => ({ ...e, n: (e.registrations ?? []).length }))
    .sort((a, b) => b.n - a.n)[0];
  if (!best) throw new Error("no events in DB");
  console.log(`Event picked: ${best.name} (${best.slug})  ${best.n} regs\n`);
  return best.slug;
}

async function login(page) {
  await page.goto(`${ORIGIN}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
}

/**
 * Detect horizontal overflow + clipped text. Returns an array of
 * {selector, label, scrollWidth, clientWidth} for elements wider than
 * their parent's content box. Excludes obvious offenders (tables that
 * scroll on purpose, overflow-x-auto containers).
 */
async function findOverflows(page) {
  return page.evaluate(() => {
    const issues = [];
    const docW = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > docW + 1) {
      issues.push({
        selector: "html",
        label: "page horizontal scroll",
        sw: document.documentElement.scrollWidth,
        cw: docW,
      });
    }
    // Look for elements wider than viewport that aren't intentionally scrollable.
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      if (el.children.length > 200) continue; // huge wrappers, not interesting
      const cs = getComputedStyle(el);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowX === "hidden") continue;
      // Skip inputs/selects (their scrollWidth is content-based).
      if (/^(input|select|textarea)$/i.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1 && el.scrollWidth > docW) {
        const tag = el.tagName.toLowerCase();
        const cls = (el.className && typeof el.className === "string" ? el.className : "").slice(0, 80);
        issues.push({
          selector: `${tag}.${cls.replace(/\s+/g, ".")}`,
          label: (el.innerText || "").slice(0, 60),
          sw: el.scrollWidth,
          cw: el.clientWidth,
        });
        if (issues.length >= 8) break;
      }
    }
    return issues;
  });
}

async function visit(browser, slug, surface) {
  const report = { surface: surface.name, viewports: [] };
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text().slice(0, 200)}`); });

    await login(page);
    const url = `${ORIGIN}${surface.path(slug)}`;
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch((e) => ({ status: () => 0, _err: e }));
    await page.waitForTimeout(500); // let any post-mount fetches settle

    const status = res?.status?.() ?? 0;
    const overflows = await findOverflows(page);
    const file = resolve(OUT_DIR, `${surface.name}-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    report.viewports.push({ vp: vp.name, status, errors, overflows, file });
    await ctx.close();
  }
  return report;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const slug = await ensureUser();

  const SURFACES = [
    { name: "event-manage",  path: (s) => `/admin/events/${s}` },
    { name: "counter-desk",  path: (s) => `/admin/events/${s}/counter` },
    { name: "registrations", path: (s) => `/admin/events/${s}/registrations` },
    { name: "weighin",       path: (s) => `/admin/events/${s}/weighin` },
    { name: "print-index",   path: (s) => `/admin/events/${s}/print` },
    { name: "print-nominal", path: (s) => `/admin/events/${s}/print/nominal` },
    { name: "print-category",path: (s) => `/admin/events/${s}/print/category` },
  ];

  const browser = await chromium.launch({ headless: true });
  const reports = [];
  for (const s of SURFACES) {
    process.stdout.write(`▸ ${s.name} `);
    try {
      const r = await visit(browser, slug, s);
      reports.push(r);
      process.stdout.write(`✓\n`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
      reports.push({ surface: s.name, error: e.message });
    }
  }
  await browser.close();

  console.log(`\n=== REPORT ===\n`);
  for (const r of reports) {
    console.log(`\n## ${r.surface}`);
    if (r.error) { console.log(`  ! failed: ${r.error}`); continue; }
    for (const v of r.viewports) {
      const flag = v.status === 200 && v.errors.length === 0 && v.overflows.length === 0 ? "✓" : "⚠";
      console.log(`  ${flag} ${v.vp}px  status=${v.status}  errors=${v.errors.length}  overflows=${v.overflows.length}`);
      if (v.errors.length) v.errors.slice(0, 3).forEach((e) => console.log(`     err: ${e}`));
      if (v.overflows.length)
        v.overflows.slice(0, 5).forEach((o) =>
          console.log(`     overflow: ${o.selector}  ${o.sw}>${o.cw}  "${o.label}"`),
        );
      console.log(`     png:  ${v.file}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

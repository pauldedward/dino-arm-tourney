#!/usr/bin/env node
// Smoke test for the operator dashboard + grouped registrations view.
//
// Boots an authed SSR session against a running dev/preview server, fetches
// the offline-mode test event's dashboard and the by-district registrations
// view, and asserts the key UI markers are in the HTML.
//
// Usage: node --env-file=.env.local scripts/smoke-dashboard.mjs [origin]
// Default origin: http://localhost:3000
//
// Exits non-zero on any assertion failure.

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.argv[2] || "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPA || !ANON || !SVC) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE_KEY env.");
  process.exit(2);
}

const failures = [];
function expect(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
    failures.push(name);
  }
}

async function authedCookieHeader() {
  const svc = createClient(SUPA, SVC, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = "perf-bench@dino.local";
  const password = "perfbench-secret-1234";
  const { data: existing } = await svc
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  let userId = existing?.id;
  if (!userId) {
    const { data: cr, error } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = cr.user.id;
  } else {
    await svc.auth.admin.updateUserById(userId, { password, email_confirm: true });
  }
  await svc.from("profiles").upsert({
    id: userId,
    email,
    role: "super_admin",
    full_name: "Perf Bench",
    disabled_at: null,
  });

  const jar = new Map();
  const ssr = createServerClient(SUPA, ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) jar.set(c.name, c.value);
      },
    },
  });
  const { error } = await ssr.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await ssr.auth.getUser();
  if (jar.size === 0) throw new Error("no auth cookies captured");
  return [...jar.entries()]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

async function get(path, cookie) {
  const r = await fetch(`${ORIGIN}${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  const body = await r.text();
  return { status: r.status, body };
}

async function main() {
  console.log(`Smoke @ ${ORIGIN}`);
  const cookie = await authedCookieHeader();

  console.log("\n[1] /admin/events/test (offline-mode dashboard)");
  {
    const { status, body } = await get("/admin/events/test", cookie);
    expect("returns 200", status === 200, `got ${status}`);
    expect("renders mode pill", /Pay at venue/i.test(body));
    expect("renders % collected stat", /% Collected/i.test(body));
    expect("renders by-district card", /By district/i.test(body));
    expect(
      "shows Chennai district row",
      /Chennai/.test(body),
      "Chennai not in HTML",
    );
    expect(
      "shows Kallakurichi district row",
      /Kallakurichi/.test(body),
      "Kallakurichi not in HTML",
    );
    expect(
      "no React hydration error markers",
      !/Hydration failed|did not match|Text content does not match/i.test(body),
    );
  }

  console.log("\n[2] /admin/events/test/registrations?group=district");
  {
    const { status, body } = await get(
      "/admin/events/test/registrations?group=district",
      cookie,
    );
    expect("returns 200", status === 200, `got ${status}`);
    expect("renders sticky thead", /sticky top-\[60px\]/.test(body));
    // Group rows render client-side after data fetch, so SSR HTML won't
    // include them. We only verify the toggle entry-point label is present.
    expect("renders By-district toggle", /By district/i.test(body));
    expect(
      "select inputs are named",
      /name="filter-(division|status|payment)"/.test(body),
      "filter selects missing name",
    );
    expect(
      "row checkboxes have aria-label",
      /aria-label="Select [^"]+"/.test(body),
      "row checkboxes missing aria-label",
    );
  }

  console.log("\n[3] /e/test (public event page)");
  {
    const { status, body } = await get("/e/test", cookie);
    expect("returns 200", status === 200, `got ${status}`);
    expect("shows Pay at venue badge", /Pay at venue/i.test(body));
  }

  console.log(
    `\n${failures.length === 0 ? "PASS" : "FAIL"} -- ${failures.length} failure(s)`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

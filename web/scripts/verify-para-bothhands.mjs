// One-shot verification: confirm that registrations with para_hand='B'
// fan out to BOTH the …-R and …-L category buckets in the live category
// loader (same code path the Category Sheet + Challonge page + Challonge
// push share). Run with:
//   node --env-file=.env.local --import tsx scripts/verify-para-bothhands.mjs
import { createClient } from "@supabase/supabase-js";

const { resolveEntries } = await import("../src/lib/rules/resolve.ts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// 1) Find a registration that already has para_hand='B'. If none exist,
//    pick any para registration with para_hand in (R,L), TEMPORARILY flip
//    it to 'B', run the check, then restore.
const { data: existingB } = await sb
  .from("registrations")
  .select(
    "id, event_id, full_name, chest_no, declared_weight_kg, gender, para_codes, para_hand, nonpara_classes, nonpara_hands, nonpara_hand, weight_overrides, lifecycle_status, discipline_status, checkin_status",
  )
  .eq("para_hand", "B")
  .not("para_codes", "is", null)
  .limit(1);

let target = existingB?.[0];
let needsRestore = false;
let originalHand = null;

if (!target) {
  const { data: anyPara } = await sb
    .from("registrations")
    .select(
      "id, event_id, full_name, chest_no, declared_weight_kg, gender, para_codes, para_hand, nonpara_classes, nonpara_hands, nonpara_hand, weight_overrides, lifecycle_status, discipline_status, checkin_status",
    )
    .in("para_hand", ["R", "L"])
    .not("para_codes", "is", null)
    .limit(1);
  target = anyPara?.[0];
  if (!target) {
    console.error("no para registration found in DB to test against");
    process.exit(2);
  }
  originalHand = target.para_hand;
  await sb.from("registrations").update({ para_hand: "B" }).eq("id", target.id);
  target.para_hand = "B";
  needsRestore = true;
  console.log(
    `[setup] temporarily flipped reg ${target.id} para_hand ${originalHand} -> B`,
  );
}

console.log("[target]", {
  id: target.id,
  event_id: target.event_id,
  full_name: target.full_name,
  chest_no: target.chest_no,
  para_codes: target.para_codes,
  para_hand: target.para_hand,
  declared_weight_kg: target.declared_weight_kg,
  gender: target.gender,
});

// 2) Pull latest weigh-in (if any).
const { data: wis } = await sb
  .from("weigh_ins")
  .select("measured_kg, weighed_at")
  .eq("registration_id", target.id)
  .order("weighed_at", { ascending: false })
  .limit(1);
const latest = wis?.[0] ? { measured_kg: Number(wis[0].measured_kg) } : null;

// 3) Build the same RegistrationLite shape live-categories.ts builds.
const lite = {
  id: target.id,
  gender: target.gender,
  declared_weight_kg: Number(target.declared_weight_kg ?? 0),
  nonpara_classes: target.nonpara_classes ?? [],
  nonpara_hands:
    target.nonpara_hands ??
    (target.nonpara_classes ?? []).map(() => target.nonpara_hand ?? null),
  para_codes: target.para_codes ?? [],
  para_hand: target.para_hand ?? null,
  weight_overrides: target.weight_overrides ?? null,
};

const resolved = resolveEntries(lite, latest, new Date().getUTCFullYear());

console.log("[resolved entries] count =", resolved.length);
for (const e of resolved) {
  console.log("  -", e.category_code, "(hand=" + e.hand + ", div=" + e.division + ")");
}

const paraEntries = resolved.filter((e) =>
  (target.para_codes ?? []).some((c) => e.category_code.startsWith(c + "-")),
);
const hands = new Set(paraEntries.map((e) => e.hand));
const ok = hands.has("R") && hands.has("L");
console.log(
  ok
    ? "[PASS] para_hand=B fans out to BOTH R and L"
    : "[FAIL] para_hand=B did NOT fan out to both arms (got: " + [...hands].join(",") + ")",
);

// 4) Restore.
if (needsRestore) {
  await sb
    .from("registrations")
    .update({ para_hand: originalHand })
    .eq("id", target.id);
  console.log(`[teardown] restored reg ${target.id} para_hand -> ${originalHand}`);
}

process.exit(ok ? 0 : 1);

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isOperator } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { resolveEntries, type RegistrationLite } from "@/lib/rules/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Entry = {
  id?: string;
  registration_id: string;
  division: string;
  age_band: string;
  weight_class: string;
  hand: "R" | "L";
  category_code: string;
  seed?: number;
  district?: string | null;
};

export async function POST(req: NextRequest) {
  const sess = await getSession();
  if (!isOperator(sess.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { event_id } = (await req.json()) as { event_id?: string };
  if (!event_id) return NextResponse.json({ ok: false, error: "event_id required" }, { status: 400 });

  const admin = createAdminClient();

  // 1. Pull registrations + latest weigh-in for each.
  const { data: regsRaw, error: regErr } = await admin
    .from("registrations")
    .select(
      "id, division, declared_weight_kg, age_categories, youth_hand, senior_hand, is_para, para_class, district, status"
    )
    .eq("event_id", event_id)
    .in("status", ["paid", "weighed_in"]);
  if (regErr) return NextResponse.json({ ok: false, error: regErr.message }, { status: 500 });
  const regs = (regsRaw ?? []) as Array<RegistrationLite & { district: string | null; status: string }>;

  const { data: weighs } = await admin
    .from("weigh_ins")
    .select("registration_id, measured_kg, weighed_at")
    .in("registration_id", regs.map((r) => r.id))
    .order("weighed_at", { ascending: false });
  const latestByReg = new Map<string, { measured_kg: number }>();
  for (const w of weighs ?? []) {
    if (!latestByReg.has(w.registration_id)) latestByReg.set(w.registration_id, { measured_kg: w.measured_kg });
  }

  // 2. Resolve entries.
  const resolved: Entry[] = [];
  for (const reg of regs) {
    const weighIn = latestByReg.get(reg.id) ?? null;
    for (const e of resolveEntries(reg, weighIn)) {
      resolved.push({ ...e, district: reg.district });
    }
  }

  // 3. Wipe + reinsert entries + fixtures for this event.
  await admin.from("fixtures").delete().eq("event_id", event_id);
  // Find existing entries for this event's registrations and delete.
  const regIds = regs.map((r) => r.id);
  await admin.from("entries").delete().in("registration_id", regIds);

  if (resolved.length === 0) {
    await recordAudit({
      action: "fixtures.generate",
      eventId: event_id,
      actorId: sess.user!.id,
      actorLabel: sess.fullName ?? sess.user!.email,
      payload: { categories: 0, entries: 0, fixtures: 0 },
    });
    return NextResponse.json({ ok: true, categories: 0, entries: 0, fixtures: 0 });
  }

  const { data: insertedRaw, error: insErr } = await admin
    .from("entries")
    .insert(
      resolved.map((e) => ({
        registration_id: e.registration_id,
        division: e.division,
        age_band: e.age_band,
        weight_class: e.weight_class,
        hand: e.hand,
        category_code: e.category_code,
      }))
    )
    .select("id, registration_id, category_code");
  if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });

  // Map back to include district + entry id for seeding.
  const districtByReg = new Map<string, string | null>();
  for (const r of regs) districtByReg.set(r.id, r.district);
  type FullEntry = { id: string; registration_id: string; category_code: string; district: string | null };
  const fullEntries: FullEntry[] = (insertedRaw ?? []).map((e) => ({
    id: e.id as string,
    registration_id: e.registration_id as string,
    category_code: e.category_code as string,
    district: districtByReg.get(e.registration_id as string) ?? null,
  }));

  // 4. For each category, seed with district-spread heuristic and build single-elim.
  const byCat = new Map<string, FullEntry[]>();
  for (const e of fullEntries) {
    const list = byCat.get(e.category_code) ?? [];
    list.push(e);
    byCat.set(e.category_code, list);
  }

  type Fixture = {
    event_id: string;
    category_code: string;
    round_no: number;
    match_no: number;
    entry_a_id: string | null;
    entry_b_id: string | null;
  };
  const allFixtures: Fixture[] = [];

  for (const [code, list] of byCat) {
    const seeded = districtSpread(list);
    const bracket = buildSingleElim(seeded.map((e) => e.id));
    for (const m of bracket) {
      allFixtures.push({
        event_id,
        category_code: code,
        round_no: m.round,
        match_no: m.match,
        entry_a_id: m.a,
        entry_b_id: m.b,
      });
    }
  }

  if (allFixtures.length > 0) {
    const { error: fxErr } = await admin.from("fixtures").insert(allFixtures);
    if (fxErr) return NextResponse.json({ ok: false, error: fxErr.message }, { status: 500 });
  }

  await recordAudit({
    action: "fixtures.generate",
    eventId: event_id,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    payload: { categories: byCat.size, entries: resolved.length, fixtures: allFixtures.length },
  });
  return NextResponse.json({
    ok: true,
    categories: byCat.size,
    entries: resolved.length,
    fixtures: allFixtures.length,
  });
}

/** Reorder entries so the same district is spread far apart. Greedy. */
function districtSpread<T extends { district: string | null }>(list: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const e of list) {
    const k = e.district ?? "_";
    const b = buckets.get(k) ?? [];
    b.push(e);
    buckets.set(k, b);
  }
  const ordered = [...buckets.values()].sort((a, b) => b.length - a.length);
  const out: T[] = [];
  let safety = list.length * 4;
  while (out.length < list.length && safety-- > 0) {
    for (const b of ordered) {
      const item = b.shift();
      if (item) out.push(item);
      if (out.length === list.length) break;
    }
  }
  return out;
}

/**
 * Build a single-elimination bracket. Returns matches in (round, match) order.
 * Round 1 has byes for the top seeds. Subsequent rounds reference TBD.
 */
function buildSingleElim(entryIds: string[]): Array<{
  round: number; match: number; a: string | null; b: string | null;
}> {
  const n = entryIds.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{ round: 1, match: 1, a: entryIds[0], b: null }];
  }
  const size = nextPow2(n);
  const byes = size - n;
  // Standard seeding: pad with nulls at the bottom-half so top seeds get byes.
  const seeded: (string | null)[] = [...entryIds, ...Array<null>(byes).fill(null)];
  const matches: Array<{ round: number; match: number; a: string | null; b: string | null }> = [];

  // Round 1 pairs i with (size-1-i).
  let round = 1;
  let matchNo = 1;
  let prevWinnersCount = size / 2;
  for (let i = 0; i < size / 2; i++) {
    matches.push({
      round, match: matchNo++,
      a: seeded[i],
      b: seeded[size - 1 - i],
    });
  }
  // Subsequent rounds — pairings TBD (entry ids null).
  while (prevWinnersCount > 1) {
    round++;
    const thisRound = prevWinnersCount / 2;
    matchNo = 1;
    for (let i = 0; i < thisRound; i++) {
      matches.push({ round, match: matchNo++, a: null, b: null });
    }
    prevWinnersCount = thisRound;
  }
  return matches;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

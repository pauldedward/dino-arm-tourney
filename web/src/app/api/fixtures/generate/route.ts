import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";
import { resolveEntries, type RegistrationLite } from "@/lib/rules/resolve";
import { buildFixtures, type SeededEntry } from "@/lib/rules/bracket";

export const runtime = "nodejs";

/**
 * POST /api/fixtures/generate
 * Body: { event_id: string }
 *
 * Rebuilds entries + fixtures for an event. Idempotent: wipes prior
 * entries and fixtures for the event before inserting. Only registrations
 * with at least one weigh-in capture contribute — payment status is
 * intentionally NOT a gate here, but a measured weight is, since the
 * resolver and bracket builder must know the real weight class. Athletes
 * who never weighed in stay off the category sheet and out of the
 * fixtures even if they paid.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole("operator", "/admin");

  const body = (await req.json().catch(() => ({}))) as { event_id?: string };
  const eventId = body.event_id;
  if (!eventId) {
    return NextResponse.json({ error: "event_id required" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select("id, name, starts_at, status, bracket_format")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "event not found" }, { status: 404 });
  // Only double-elim is shipping today. The schema also allows
  // `single_elim` and `round_robin` for forward-compat, but those
  // generators aren't implemented yet — log the requested format and
  // fall back so we never produce broken fixtures.
  const requestedFormat = (event.bracket_format as string) ?? "double_elim";
  if (requestedFormat !== "double_elim") {
    console.warn(
      `[fixtures.generate] event ${eventId} requested format=${requestedFormat}; falling back to double_elim (only supported format)`
    );
  }
  const bracketFormat = "double_elim";

  // Eligible registrations: any status except withdrawn/disqualified.
  // Payment is NOT required to weigh in, so we include `pending` here
  // and use the presence of a weigh_ins row below as the real gate.
  const { data: regs, error: regErr } = await svc
    .from("registrations")
    .select(
      "id, chest_no, declared_weight_kg, district, team, gender, nonpara_classes, nonpara_hand, nonpara_hands, para_codes, para_hand, status"
    )
    .eq("event_id", eventId)
    .in("status", ["pending", "paid", "weighed_in"])
    .order("chest_no", { ascending: true, nullsFirst: false });
  if (regErr) return NextResponse.json({ error: regErr.message }, { status: 500 });

  // Fetch latest weigh-in per registration in one query. We deliberately
  // use an inner-join on registrations.event_id rather than an `.in()` list
  // of registration ids — with ~800+ athletes the IN-list version produces
  // a 30 KB+ URL that PostgREST silently truncates, leaving `wis` empty
  // and the whole generate run returning 0/0/0.
  const { data: wisRaw, error: wiErr } = await svc
    .from("weigh_ins")
    .select(
      "registration_id, measured_kg, weighed_at, registrations!inner(event_id)"
    )
    .eq("registrations.event_id", eventId)
    .order("weighed_at", { ascending: false });
  if (wiErr) return NextResponse.json({ error: wiErr.message }, { status: 500 });
  const wis = (wisRaw ?? []) as Array<{
    registration_id: string;
    measured_kg: number;
    weighed_at: string;
  }>;
  const latestWi = new Map<string, { measured_kg: number }>();
  for (const w of wis) {
    if (!latestWi.has(w.registration_id)) {
      latestWi.set(w.registration_id, { measured_kg: Number(w.measured_kg) });
    }
  }

  // Hard gate: only registrations with a weigh-in row make it onto the
  // category sheet / fixtures. This is the rule the user asked for —
  // unpaid+weighed athletes are eligible; paid+un-weighed athletes are
  // not (their declared weight isn't trustworthy enough to seed a draw).
  const eligibleRegs = (regs ?? []).filter((r) => latestWi.has(r.id));

  const refYear = event.starts_at
    ? new Date(event.starts_at).getUTCFullYear()
    : new Date().getUTCFullYear();

  type GroupedEntry = {
    registration_id: string;
    chest_no: number | null;
    district: string | null;
    team: string | null;
    division: string;
    age_band: string;
    weight_class: string;
    hand: "R" | "L";
    category_code: string;
  };

  const allEntries: GroupedEntry[] = [];
  for (const r of eligibleRegs) {
    if (r.gender !== "M" && r.gender !== "F") continue;
    const lite: RegistrationLite = {
      id: r.id,
      gender: r.gender as "M" | "F",
      declared_weight_kg: Number(r.declared_weight_kg ?? 0),
      nonpara_classes: (r.nonpara_classes as string[] | null) ?? [],
      nonpara_hands:
        (r.nonpara_hands as RegistrationLite["nonpara_hands"]) ??
        // Fallback: replicate legacy single hand across each class.
        ((r.nonpara_classes as string[] | null) ?? []).map(
          () => (r.nonpara_hand as "R" | "L" | "B" | null) ?? null
        ),
      para_codes: (r.para_codes as string[] | null) ?? [],
      para_hand: (r.para_hand as RegistrationLite["para_hand"]) ?? null,
    };
    const resolved = resolveEntries(lite, latestWi.get(r.id) ?? null, refYear);
    for (const e of resolved) {
      allEntries.push({
        chest_no: r.chest_no,
        district: r.district,
        team: r.team,
        ...e,
      });
    }
  }

  // Wipe prior fixtures + entries for this event. Fixtures are scoped by
  // event_id directly; entries reference registrations and have to be
  // deleted via the registration ids — chunked, because PostgREST URL
  // length caps at ~8 KB and ~200 UUIDs per .in() is the safe limit.
  await svc.from("fixtures").delete().eq("event_id", eventId);
  const allRegIds = (regs ?? []).map((r) => r.id);
  const DELETE_CHUNK = 200;
  for (let i = 0; i < allRegIds.length; i += DELETE_CHUNK) {
    const chunk = allRegIds.slice(i, i + DELETE_CHUNK);
    const { error: delErr } = await svc
      .from("entries")
      .delete()
      .in("registration_id", chunk);
    if (delErr)
      return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  if (allEntries.length === 0) {
    await recordAudit({
      eventId,
      actorId: session.userId,
      actorLabel: session.fullName ?? session.email,
      action: "fixtures.generate",
      payload: { categories: 0, entries: 0, fixtures: 0 },
    });
    return NextResponse.json({ ok: true, categories: 0, entries: 0, fixtures: 0 });
  }

  // Insert entries in chunks, then read back their ids.
  const { data: insertedEntries, error: entErr } = await svc
    .from("entries")
    .insert(
      allEntries.map((e) => ({
        registration_id: e.registration_id,
        division: e.division,
        age_band: e.age_band,
        weight_class: e.weight_class,
        hand: e.hand,
        category_code: e.category_code,
      }))
    )
    .select("id, registration_id, category_code");
  if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });

  // Map (registration_id, category_code) -> entry_id for fixture wiring.
  const entryIdByKey = new Map<string, string>();
  for (const ent of insertedEntries ?? []) {
    entryIdByKey.set(`${ent.registration_id}|${ent.category_code}`, ent.id);
  }

  // Group entries by category, build bracket, collect fixture rows.
  const byCategory = new Map<string, GroupedEntry[]>();
  for (const e of allEntries) {
    if (!byCategory.has(e.category_code)) byCategory.set(e.category_code, []);
    byCategory.get(e.category_code)!.push(e);
  }

  type FixtureRow = {
    event_id: string;
    category_code: string;
    bracket_side: "W" | "L" | "GF";
    round_no: number;
    match_no: number;
    entry_a_id: string | null;
    entry_b_id: string | null;
    next_round_no: number | null;
    next_match_no: number | null;
    next_bracket_side: "W" | "L" | "GF" | null;
    loser_next_round_no: number | null;
    loser_next_match_no: number | null;
    loser_next_bracket_side: "W" | "L" | "GF" | null;
    best_of: number;
  };
  const fixtures: FixtureRow[] = [];
  for (const [code, list] of byCategory) {
    // Stable seed by chest_no asc (unseeded entries sort last).
    const seeded: SeededEntry[] = list
      .slice()
      .sort((a, b) => (a.chest_no ?? 1e9) - (b.chest_no ?? 1e9))
      .map((e) => ({
        entry_id: entryIdByKey.get(`${e.registration_id}|${code}`)!,
        district: e.district,
        team: e.team,
      }));
    const matches = buildFixtures(seeded, bracketFormat);
    for (const m of matches) {
      fixtures.push({
        event_id: eventId,
        category_code: code,
        bracket_side: m.bracket_side,
        round_no: m.round_no,
        match_no: m.match_no,
        entry_a_id: m.a_entry_id,
        entry_b_id: m.b_entry_id,
        next_round_no: m.next_round_no,
        next_match_no: m.next_match_no,
        next_bracket_side: m.next_bracket_side,
        loser_next_round_no: m.loser_next_round_no,
        loser_next_match_no: m.loser_next_match_no,
        loser_next_bracket_side: m.loser_next_bracket_side,
        best_of: m.best_of,
      });
    }
  }

  let fxCount = 0;
  if (fixtures.length > 0) {
    const { error: fxErr, count } = await svc
      .from("fixtures")
      .insert(fixtures, { count: "exact" });
    if (fxErr) return NextResponse.json({ error: fxErr.message }, { status: 500 });
    fxCount = count ?? fixtures.length;
  }

  await recordAudit({
    eventId,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "fixtures.generate",
    payload: {
      categories: byCategory.size,
      entries: allEntries.length,
      fixtures: fxCount,
      bracket_format: bracketFormat,
    },
  });

  return NextResponse.json({
    ok: true,
    categories: byCategory.size,
    entries: allEntries.length,
    fixtures: fxCount,
  });
}

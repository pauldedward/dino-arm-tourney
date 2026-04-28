#!/usr/bin/env node
/**
 * Day-7 dress rehearsal: exercise the full match-day pipeline against
 * seeded sample data, bypassing the HTTP layer so we can prove the
 * business logic end-to-end.
 *
 *   1. Pick the TN State 2026 event.
 *   2. Force every sample registration to paid or weighed_in.
 *   3. Insert synthetic weigh_ins for ~half of them.
 *   4. Generate fixtures the same way /api/fixtures/generate does.
 *   5. Render every PDF via @react-pdf/renderer to disk under
 *      research/rehearsal-out/.
 *   6. Print row counts + file sizes.
 *
 *   Usage:  npm run rehearsal
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";

import { resolveEntries } from "@/lib/rules/resolve";
import { buildBracket } from "@/lib/rules/bracket";
import { NominalSheet } from "@/lib/pdf/NominalSheet";
import { CategorySheet } from "@/lib/pdf/CategorySheet";
import { IdCardSheet } from "@/lib/pdf/IdCardSheet";
import { FixturesSheet } from "@/lib/pdf/FixturesSheet";

const OUT = new URL("../../research/rehearsal-out/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function log(stage, info) {
  console.log(`[${stage}] ${info}`);
}

async function main() {
  const { data: events } = await sb
    .from("events")
    .select("*")
    .neq("status", "archived")
    .order("starts_at", { ascending: false })
    .limit(1);
  const event = events?.[0];
  if (!event) throw new Error("no non-archived event found; run seed first");
  log("event", `${event.name} (${event.id})`);

  // Force registrations to paid/weighed_in for the rehearsal.
  const { data: regs } = await sb
    .from("registrations")
    .select("*")
    .eq("event_id", event.id);
  if (!regs?.length) throw new Error("no registrations for event");

  const half = Math.floor(regs.length / 2);
  // Keep the last reg as "pending" so we never touch it after fixtures,
  // avoiding the cross-talk of deleting entries that were already written.
  const pendingReg = regs[regs.length - 1];
  const pool = regs.filter((r) => r.id !== pendingReg.id);
  const paidIds = pool.slice(half).map((r) => r.id);
  const weighedIds = pool.slice(0, half).map((r) => r.id);

  await sb
    .from("registrations")
    .update({ status: "pending" })
    .eq("id", pendingReg.id);
  await sb
    .from("payments")
    .update({ status: "pending" })
    .eq("registration_id", pendingReg.id);

  if (paidIds.length)
    await sb.from("registrations").update({ status: "paid" }).in("id", paidIds);
  if (weighedIds.length)
    await sb
      .from("registrations")
      .update({ status: "weighed_in" })
      .in("id", weighedIds);

  // Synthetic weigh-ins within ±1 kg of declared.
  await sb.from("weigh_ins").delete().in("registration_id", weighedIds);
  const wiRows = weighedIds.map((id) => {
    const r = regs.find((x) => x.id === id);
    const base = Number(r.declared_weight_kg ?? 70);
    const jitter = (Math.random() - 0.5) * 2;
    const kg = Math.max(25, Math.min(180, base + jitter));
    return {
      registration_id: id,
      measured_kg: Number(kg.toFixed(2)),
      live_photo_url: null,
      weighed_by: null,
    };
  });
  if (wiRows.length) {
    const { error } = await sb.from("weigh_ins").insert(wiRows);
    if (error) throw error;
  }
  log("registrations", `paid=${paidIds.length} weighed_in=${weighedIds.length}`);

  // --- Fixtures (mirror of /api/fixtures/generate) --------------------------
  const { data: regsLive } = await sb
    .from("registrations")
    .select("*")
    .eq("event_id", event.id)
    .in("status", ["paid", "weighed_in"]);
  const { data: latest } = await sb
    .from("weigh_ins")
    .select("registration_id, measured_kg, weighed_at")
    .in("registration_id", regsLive.map((r) => r.id))
    .order("weighed_at", { ascending: false });
  const latestMap = new Map();
  for (const w of latest ?? []) {
    if (!latestMap.has(w.registration_id)) latestMap.set(w.registration_id, w);
  }

  const refYear = new Date(event.starts_at ?? Date.now()).getFullYear();
  const allEntries = [];
  for (const r of regsLive) {
    const lite = {
      id: r.id,
      division: r.division,
      dob: r.dob,
      declared_weight_kg: r.declared_weight_kg,
      age_categories: r.age_categories,
      youth_hand: r.youth_hand,
      senior_hand: r.senior_hand,
      is_para: r.division?.startsWith("Para") ?? false,
      para_class: null,
    };
    const wi = latestMap.get(r.id);
    const resolved = resolveEntries(
      lite,
      wi ? { measured_kg: Number(wi.measured_kg) } : null,
      refYear
    );
    for (const e of resolved) {
      allEntries.push({
        registration_id: r.id,
        chest_no: r.chest_no,
        district: r.district,
        team: r.team,
        ...e,
      });
    }
  }

  // Wipe and reinsert.
  await sb.from("fixtures").delete().eq("event_id", event.id);
  const { data: regIds } = await sb
    .from("registrations")
    .select("id")
    .eq("event_id", event.id);
  await sb
    .from("entries")
    .delete()
    .in("registration_id", (regIds ?? []).map((r) => r.id));

  const entryRows = allEntries.map((e) => ({
    registration_id: e.registration_id,
    division: e.division,
    age_band: e.age_band,
    weight_class: e.weight_class,
    hand: e.hand,
    category_code: e.category_code,
  }));
  const { data: insertedEntries, error: entryErr } = await sb
    .from("entries")
    .insert(entryRows)
    .select("id, registration_id, category_code, hand");
  if (entryErr) throw entryErr;
  log("entries", `inserted=${insertedEntries.length}`);

  const byCat = new Map();
  for (const e of insertedEntries) {
    if (!byCat.has(e.category_code)) byCat.set(e.category_code, []);
    byCat.get(e.category_code).push(e);
  }
  let fixtureCount = 0;
  for (const [code, es] of byCat) {
    const chest = new Map(regsLive.map((r) => [r.id, r.chest_no ?? 9999]));
    es.sort((a, b) => chest.get(a.registration_id) - chest.get(b.registration_id));
    const bracket = buildBracket(
      es.map((e) => ({ entry_id: e.id, district: null, team: null }))
    );
    const rows = bracket.map((b) => ({
      event_id: event.id,
      category_code: code,
      round_no: b.round_no,
      match_no: b.match_no,
      entry_a_id: b.a_entry_id ?? null,
      entry_b_id: b.b_entry_id ?? null,
    }));
    if (rows.length) {
      const { error } = await sb.from("fixtures").insert(rows);
      if (error) throw error;
      fixtureCount += rows.length;
    }
  }
  log("fixtures", `categories=${byCat.size} fixtures=${fixtureCount}`);

  // --- Render all PDFs -------------------------------------------------------
  const nominalRows = regsLive.map((r) => ({
    chest_no: r.chest_no,
    full_name: r.full_name,
    division: r.division,
    district: r.district,
    team: r.team,
    declared_weight_kg: r.declared_weight_kg,
    age_categories: r.age_categories,
    status: r.status,
  }));
  await writePdf(
    "nominal.pdf",
    React.createElement(NominalSheet, { event: { name: event.name }, rows: nominalRows })
  );

  const catGroups = new Map();
  for (const e of insertedEntries) {
    const reg = regsLive.find((r) => r.id === e.registration_id);
    if (!catGroups.has(e.category_code)) catGroups.set(e.category_code, []);
    catGroups.get(e.category_code).push({
      chest_no: reg?.chest_no ?? null,
      full_name: reg?.full_name ?? null,
      district: reg?.district ?? null,
    });
  }
  const categories = Array.from(catGroups.entries()).map(
    ([category_code, athletes]) => ({ category_code, athletes })
  );
  await writePdf(
    "category.pdf",
    React.createElement(CategorySheet, { event: { name: event.name }, categories })
  );

  const idRows = regsLive.map((r) => ({
    chest_no: r.chest_no,
    full_name: r.full_name,
    division: r.division,
    district: r.district,
    team: r.team,
    declared_weight_kg: r.declared_weight_kg,
  }));
  await writePdf(
    "id-cards.pdf",
    React.createElement(IdCardSheet, { event, rows: idRows })
  );

  // Fixtures PDF shape: { category_code, rounds: [{round_no, matches: [{match_no, a, b}]}] }
  const { data: fixRows } = await sb
    .from("fixtures")
    .select(
      "category_code, round_no, match_no, entry_a_id, entry_b_id"
    )
    .eq("event_id", event.id)
    .order("category_code", { ascending: true })
    .order("round_no", { ascending: true })
    .order("match_no", { ascending: true });
  const entryIdToLabel = new Map(
    insertedEntries.map((e) => {
      const reg = regsLive.find((r) => r.id === e.registration_id);
      return [
        e.id,
        reg ? `#${reg.chest_no ?? ""} ${reg.full_name ?? ""}` : null,
      ];
    })
  );
  const fxByCat = new Map();
  for (const f of fixRows ?? []) {
    if (!fxByCat.has(f.category_code)) fxByCat.set(f.category_code, new Map());
    const byRound = fxByCat.get(f.category_code);
    if (!byRound.has(f.round_no)) byRound.set(f.round_no, []);
    byRound.get(f.round_no).push({
      match_no: f.match_no,
      a: entryIdToLabel.get(f.entry_a_id) ?? null,
      b: entryIdToLabel.get(f.entry_b_id) ?? null,
    });
  }
  const fxCategories = Array.from(fxByCat.entries()).map(([code, byRound]) => ({
    category_code: code,
    rounds: Array.from(byRound.entries())
      .sort(([a], [b]) => a - b)
      .map(([round_no, matches]) => ({ round_no, matches })),
  }));
  await writePdf(
    "fixtures.pdf",
    React.createElement(FixturesSheet, {
      event: { name: event.name },
      categories: fxCategories,
    })
  );

  // Pending dues PDF removed — Payment Report now covers the same use case.

  // Post-run assertions.
  const { data: fxCheck } = await sb
    .from("fixtures")
    .select("round_no, entry_a_id, entry_b_id")
    .eq("event_id", event.id);
  const total = fxCheck?.length ?? 0;
  // R1 is the first non-bye round and must have at least one entry in every
  // slot (unless the whole match is a BYE propagation — but buildBracket
  // never emits a {null, null} R1 match). Later rounds start empty.
  const r1Empty = (fxCheck ?? []).filter(
    (f) => f.round_no === 1 && f.entry_a_id === null && f.entry_b_id === null
  ).length;
  if (total === 0) throw new Error("ASSERT: no fixtures inserted");
  if (r1Empty > 0)
    throw new Error(`ASSERT: ${r1Empty} R1 fixtures have both entries null`);
  log("assert", `fixtures=${total} r1Empty=${r1Empty} ok`);

  log("done", `output dir: research/rehearsal-out/`);
}

async function writePdf(name, doc) {
  const buf = await renderToBuffer(doc);
  const path = new URL(name, OUT);
  writeFileSync(path, buf);
  log("pdf", `${name} ${(buf.byteLength / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Live "on-mat roster" by category for an event.
 *
 * Single source of truth shared by:
 *   - Category Sheet  (web/src/app/admin/events/[id]/print/[kind]/page.tsx)
 *   - Challonge page  (web/src/app/admin/events/[id]/categories/page.tsx)
 *   - Challonge push  (web/src/lib/challonge/push.ts -> loadCategoryParticipants)
 *
 * Runs `resolveEntries` live against `registrations` + the latest
 * `weigh_ins` row. Does not read from the materialised `entries` table —
 * that table is a snapshot written by the fixtures-generate job and
 * drifts whenever a registration is created/edited or weighed-in after
 * fixtures were last regenerated. Reading live guarantees the Category
 * Sheet, the Challonge page and the Challonge push API can never disagree.
 *
 * Eligibility filter (the on-mat roster):
 *   registrations.lifecycle_status  = 'active'
 *   registrations.discipline_status = 'clear'
 *   registrations.checkin_status    = 'weighed_in'
 *   registrations.gender            in ('M','F')   -- needed by the resolver
 */

import { createServiceClient } from "@/lib/db/supabase-service";
import { resolveEntries, type RegistrationLite } from "@/lib/rules/resolve";

export type LiveCategoryAthlete = {
  registration_id: string;
  chest_no: number | null;
  full_name: string | null;
  district: string | null;
};

export type LiveCategoryGroup = {
  category_code: string;
  athletes: LiveCategoryAthlete[];
};

export async function loadLiveCategoryGroups(
  eventId: string,
): Promise<LiveCategoryGroup[]> {
  const svc = createServiceClient();
  const [evRes, regsRes, wisRes] = await Promise.all([
    svc.from("events").select("starts_at").eq("id", eventId).maybeSingle(),
    svc
      .from("registrations")
      .select(
        "id, chest_no, full_name, district, declared_weight_kg, gender, nonpara_classes, nonpara_hands, nonpara_hand, para_codes, para_hand, weight_overrides, lifecycle_status, discipline_status, checkin_status",
      )
      .eq("event_id", eventId)
      .eq("lifecycle_status", "active")
      .eq("discipline_status", "clear")
      .eq("checkin_status", "weighed_in"),
    svc
      .from("weigh_ins")
      .select(
        "registration_id, measured_kg, weighed_at, registrations!inner(event_id)",
      )
      .eq("registrations.event_id", eventId)
      .order("weighed_at", { ascending: false }),
  ]);

  if (regsRes.error) throw new Error(`load registrations failed: ${regsRes.error.message}`);
  if (wisRes.error) throw new Error(`load weigh-ins failed: ${wisRes.error.message}`);

  const refYear = evRes.data?.starts_at
    ? new Date(evRes.data.starts_at).getUTCFullYear()
    : new Date().getUTCFullYear();

  const latestWi = new Map<string, { measured_kg: number }>();
  for (const w of wisRes.data ?? []) {
    if (!latestWi.has(w.registration_id)) {
      latestWi.set(w.registration_id, { measured_kg: Number(w.measured_kg) });
    }
  }

  const grouped = new Map<string, LiveCategoryAthlete[]>();
  for (const r of regsRes.data ?? []) {
    if (r.gender !== "M" && r.gender !== "F") continue;
    const lite: RegistrationLite = {
      id: r.id,
      gender: r.gender as "M" | "F",
      declared_weight_kg: Number(r.declared_weight_kg ?? 0),
      nonpara_classes: (r.nonpara_classes as string[] | null) ?? [],
      nonpara_hands:
        (r.nonpara_hands as RegistrationLite["nonpara_hands"]) ??
        ((r.nonpara_classes as string[] | null) ?? []).map(
          () => (r.nonpara_hand as "R" | "L" | "B" | null) ?? null,
        ),
      para_codes: (r.para_codes as string[] | null) ?? [],
      para_hand: (r.para_hand as RegistrationLite["para_hand"]) ?? null,
      weight_overrides:
        (r.weight_overrides as RegistrationLite["weight_overrides"]) ?? null,
    };
    const resolved = resolveEntries(lite, latestWi.get(r.id) ?? null, refYear);
    for (const e of resolved) {
      if (!grouped.has(e.category_code)) grouped.set(e.category_code, []);
      grouped.get(e.category_code)!.push({
        registration_id: r.id,
        chest_no: r.chest_no,
        full_name: r.full_name,
        district: r.district,
      });
    }
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category_code, athletes]) => ({
      category_code,
      athletes: athletes
        .slice()
        .sort(
          (a, b) =>
            (a.chest_no ?? 1e9) - (b.chest_no ?? 1e9) ||
            (a.full_name ?? "").localeCompare(b.full_name ?? ""),
        ),
    }));
}

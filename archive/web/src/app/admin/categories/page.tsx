import { createAdminClient } from "@/lib/supabase/admin";
import GenerateButton from "../print/GenerateButton";
import { resolveEntries, type RegistrationLite } from "@/lib/rules/resolve";

export const dynamic = "force-dynamic";

type CatRow = {
  code: string;
  division: string;
  age_band: string;
  weight_class: string;
  hand: "R" | "L";
  count: number;
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const sp = await searchParams;
  const admin = createAdminClient();

  const { data: events } = await admin
    .from("events")
    .select("id, name, slug")
    .order("starts_at", { ascending: false });
  const eventId = sp.event ?? events?.[0]?.id;

  let categories: CatRow[] = [];
  let fixtureCount = 0;
  let regCount = 0;
  let entryCount = 0;

  if (eventId) {
    const { data: regsRaw } = await admin
      .from("registrations")
      .select(
        "id, division, declared_weight_kg, age_categories, youth_hand, senior_hand, is_para, para_class, status"
      )
      .eq("event_id", eventId)
      .in("status", ["paid", "weighed_in"]);
    const regs = (regsRaw ?? []) as Array<RegistrationLite & { status: string }>;
    regCount = regs.length;

    const regIds = regs.map((r) => r.id);
    const { data: weighs } = regIds.length
      ? await admin
          .from("weigh_ins")
          .select("registration_id, measured_kg, weighed_at")
          .in("registration_id", regIds)
          .order("weighed_at", { ascending: false })
      : { data: [] as Array<{ registration_id: string; measured_kg: number }> };
    const latest = new Map<string, { measured_kg: number }>();
    for (const w of weighs ?? []) {
      if (!latest.has(w.registration_id))
        latest.set(w.registration_id, { measured_kg: w.measured_kg });
    }

    const bucket = new Map<string, CatRow>();
    for (const reg of regs) {
      for (const e of resolveEntries(reg, latest.get(reg.id) ?? null)) {
        entryCount++;
        const cur = bucket.get(e.category_code) ?? {
          code: e.category_code,
          division: e.division,
          age_band: e.age_band,
          weight_class: e.weight_class,
          hand: e.hand,
          count: 0,
        };
        cur.count++;
        bucket.set(e.category_code, cur);
      }
    }
    categories = [...bucket.values()].sort((a, b) =>
      a.division.localeCompare(b.division) ||
      a.age_band.localeCompare(b.age_band) ||
      a.weight_class.localeCompare(b.weight_class) ||
      a.hand.localeCompare(b.hand)
    );

    const { count: fx } = await admin
      .from("fixtures")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);
    fixtureCount = fx ?? 0;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b-2 border-ink pb-4">
        <h1 className="font-display text-5xl tracking-tight2">Categories</h1>
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
          Preview of bracket categories before generating fixtures
        </p>
      </div>

      <form className="border-2 border-ink p-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Event</span>
          <select
            name="event"
            defaultValue={eventId}
            className="mt-2 w-full max-w-md border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          >
            {(events ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <button className="mt-3 border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood">
          Switch event
        </button>
      </form>

      {eventId && (
        <>
          <div className="grid grid-cols-2 gap-px bg-ink md:grid-cols-4">
            <Tile n={String(regCount)} l="Eligible regs (paid/weighed)" />
            <Tile n={String(categories.length)} l="Distinct categories" />
            <Tile n={String(entryCount)} l="Bracket entries" />
            <Tile n={String(fixtureCount)} l="Existing fixtures" />
          </div>

          <div className="border-2 border-ink p-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
              Rebuild brackets
            </p>
            <GenerateButton eventId={eventId} />
            <p className="mt-2 font-mono text-xs text-ink/60">
              Wipes existing entries + fixtures and rebuilds from current
              registrations + latest weigh-ins. Single-elimination, seeded byes,
              district-spread in round 1.
            </p>
          </div>

          <div className="border-2 border-ink">
            <table className="w-full text-sm">
              <thead className="bg-ink text-bone">
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.3em]">
                  <th className="px-3 py-2">Division</th>
                  <th className="px-3 py-2">Age band</th>
                  <th className="px-3 py-2">Weight class</th>
                  <th className="px-3 py-2">Hand</th>
                  <th className="px-3 py-2 text-right">Athletes</th>
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center font-mono text-xs text-ink/60">
                      No athletes eligible yet — verify payments and record weigh-ins.
                    </td>
                  </tr>
                ) : (
                  categories.map((c) => (
                    <tr key={c.code} className="border-t border-ink/10">
                      <td className="px-3 py-2">{c.division}</td>
                      <td className="px-3 py-2">{c.age_band}</td>
                      <td className="px-3 py-2 font-mono">{c.weight_class}</td>
                      <td className="px-3 py-2 font-mono">{c.hand}</td>
                      <td className="px-3 py-2 text-right tnum">{c.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ n, l }: { n: string; l: string }) {
  return (
    <div className="bg-bone p-6">
      <p className="tnum font-display text-4xl tracking-tight2">{n}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">{l}</p>
    </div>
  );
}

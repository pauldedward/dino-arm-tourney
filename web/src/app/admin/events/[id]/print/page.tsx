import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { resolveEventRef } from "@/lib/db/resolve-event";
import PendingLink from "@/components/PendingLink";
import GenerateButton from "@/components/admin/GenerateButton";

export const dynamic = "force-dynamic";

/**
 * Each sheet declares which formats it ships in. Consolidated layout:
 * one card per sheet with both the preview link and a direct XLSX
 * download — no separate "spreadsheet exports" section to hunt for.
 */
type Sheet = {
  kind: string;
  title: string;
  blurb: string;
  hasPdf: boolean;
  hasXlsx: boolean;
  extras?: { href: (eventId: string) => string; label: string; title: string }[];
};

const SHEETS: Sheet[] = [
  {
    kind: "nominal",
    title: "Nominal Roll",
    blurb: "Alphabetical athlete list for check-in.",
    hasPdf: true,
    hasXlsx: true,
    extras: [
      {
        href: (id) => `/api/admin/nominal.zip?event_id=${id}`,
        label: "ZIP ↓",
        title:
          "ZIP with one styled XLSX per district + one per team — ready to hand to district conveners and team managers.",
      },
    ],
  },
  {
    kind: "category",
    title: "Category Sheet",
    blurb: "Athletes grouped by category × hand.",
    hasPdf: true,
    hasXlsx: true,
  },
  {
    kind: "id-cards",
    title: "ID Cards",
    blurb: "8-up A4 chest-number cards (PDF) + roster (XLSX).",
    hasPdf: true,
    hasXlsx: true,
  },
  {
    kind: "payment-report",
    title: "Payment Report",
    blurb:
      "Totals, paid vs due, GRAND TOTAL — both PDF and styled XLSX from the same data.",
    hasPdf: true,
    hasXlsx: true,
  },
  {
    kind: "fixtures",
    title: "Fixtures",
    blurb: "Bracket trees per category.",
    hasPdf: true,
    hasXlsx: false,
  },
  {
    kind: "cash-sheet",
    title: "Cash Collection (per district)",
    blurb:
      "One sheet per district with athlete + fee + signature column. Hand to the District Convener for offline events.",
    hasPdf: true,
    hasXlsx: false,
  },
];

export default async function PrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idOrSlug } = await params;
  const ref = await resolveEventRef(idOrSlug);
  if (!ref) redirect("/admin/events?gone=event");
  const eventId = ref.id;
  const eventSlug = ref.slug;
  await requireRole("operator", `/admin/events/${eventSlug}/print`);

  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select("id, name, status")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) redirect("/admin/events?gone=event");

  // Cheap COUNT(*) of existing fixtures so the header can tell the operator
  // "there are N matches in the bracket right now" — a useful before/after
  // signal next to the Generate button.
  const { count: fixturesCount } = await svc
    .from("fixtures")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
          {event.name} · Match-day printing
        </p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight">
          Sheets &amp; exports
        </h1>
        <p className="mt-2 font-mono text-[13px] text-ink/60">
          Each card opens an on-screen preview and offers PDF + XLSX
          downloads where available — no separate pages, no duplicated
          tiles.
        </p>
        <PendingLink
          href={`/admin/events/${eventSlug}`}
          prefetch
          className="mt-3 inline-block font-mono text-[12px] uppercase tracking-[0.2em] underline hover:text-rust"
        >
          ← event
        </PendingLink>
      </div>

      {/*
       * Fixtures live alongside the printable sheets because regenerating
       * brackets is a match-day-prep action: an operator opens this page,
       * picks the sheets they want, and (re)generates fixtures right here
       * so the Fixtures preview reflects the latest weigh-ins. There is no
       * separate "Categories" screen — the per-category roster ships in
       * the Category Sheet preview below.
       */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-ink bg-kraft/30 p-4">
        <div>
          <p className="font-display text-xl font-black tracking-tight">
            Fixtures &amp; brackets
          </p>
          <p className="mt-1 font-mono text-[13px] text-ink/60">
            {(fixturesCount ?? 0).toLocaleString("en-IN")} match{(fixturesCount ?? 0) === 1 ? "" : "es"} currently
            in the bracket. Rebuild after any weigh-in change.
          </p>
        </div>
        <GenerateButton eventId={eventId} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {SHEETS.map((s) => (
          <div
            key={s.kind}
            className="group flex flex-col gap-3 border-2 border-ink p-4 hover:bg-kraft/20"
          >
            <div className="min-w-0">
              <PendingLink
                href={`/admin/events/${eventSlug}/print/${s.kind}`}
                prefetch
                className="block"
              >
                <p className="font-display text-2xl font-black tracking-tight group-hover:text-rust">
                  {s.title}&nbsp;→
                </p>
                <p className="mt-1 font-mono text-[13px] text-ink/60">{s.blurb}</p>
              </PendingLink>
            </div>
            <div className="flex flex-wrap gap-2">
              {s.hasPdf && (
                <a
                  href={`/api/pdf/${s.kind}?event=${eventId}`}
                  target="_blank"
                  rel="noopener"
                  className="border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.2em] hover:bg-ink hover:text-paper"
                >
                  PDF ↗
                </a>
              )}
              {s.hasXlsx && (
                <a
                  href={`/api/admin/sheets/${s.kind}?event_id=${eventId}`}
                  className="border-2 border-ink bg-volt px-3 py-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.2em] hover:bg-rust hover:text-paper"
                >
                  XLSX ↓
                </a>
              )}
              {s.extras?.map((x) => (
                <a
                  key={x.label}
                  href={x.href(eventId)}
                  title={x.title}
                  className="border-2 border-ink bg-paper px-3 py-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.2em] hover:bg-ink hover:text-paper"
                >
                  {x.label}
                </a>
              ))}
              <PendingLink
                href={`/admin/events/${eventSlug}/print/${s.kind}`}
                prefetch
                className="ml-auto border-2 border-ink/40 px-3 py-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.2em] hover:border-ink"
              >
                preview
              </PendingLink>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


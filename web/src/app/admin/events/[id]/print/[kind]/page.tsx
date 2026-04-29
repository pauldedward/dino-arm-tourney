import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { resolveEventRef } from "@/lib/db/resolve-event";
import { groupRegistrationsByCategory } from "@/lib/registrations/group-by-category";
import type { RegistrationLite } from "@/lib/rules/resolve";
import { formatCategoryCode } from "@/lib/rules/category-label";
import { loadPaymentReport } from "@/lib/sheets/loaders";
import { isFixtureEligible } from "@/lib/registrations/eligibility";
import Pagination from "@/components/admin/Pagination";
import PreviewToolbar from "./PreviewToolbar";
import CategorySectionActions from "./CategorySectionActions";
import IdCardsGrid from "./IdCardsGrid";
import { signedUrl } from "@/lib/storage";
import {
  DistrictSummary,
  type DistrictTotal,
} from "@/components/admin/DistrictSummary";

export const dynamic = "force-dynamic";

// Friendly category labels (`Senior Men · −80 kg · Right`) become
// download-safe slugs (`senior-men-80-kg-right`) so the per-category
// CSV button produces filenames a human can read at a glance.
function slugifyCategory(label: string): string {
  return label
    .normalize("NFKD")
    // Replace any non-alphanumeric run with a single hyphen. The Unicode
    // minus sign in weight labels and the middle-dot separators all collapse.
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

// Sheets that ship in BOTH PDF and XLSX get an xlsx download button on the
// same preview page — never split across two routes. Keep this set in sync
// with /api/admin/sheets/[kind]/route.ts.
const XLSX_KINDS: ReadonlySet<string> = new Set([
  "nominal",
  "category",
  "id-cards",
  "payment-report",
]);

const SHEETS = {
  nominal: { title: "Nominal Roll", blurb: "Alphabetical athlete list for check-in." },
  category: { title: "Category Sheet", blurb: "Athletes grouped by category." },
  "id-cards": {
    title: "ID Cards",
    blurb: "CR80 portrait (54x86 mm) chest-number cards, 9-up A4 - cut on the borders to fit any standard lanyard holder.",
  },
  "payment-report": {
    title: "Payment Report",
    blurb: "Athlete payment status with paid/due totals — PDF + XLSX from the same source.",
  },
  fixtures: { title: "Fixtures", blurb: "Bracket trees per category." },
  "cash-sheet": {
    title: "Cash Collection (per district)",
    blurb:
      "Cover totals + one A4 per district with athlete, fee and signature column. Hand to the District Convener for offline cash events.",
  },
} as const;
type Kind = keyof typeof SHEETS;

function isKind(s: string): s is Kind {
  return s in SHEETS;
}

/**
 * Per-kind on-screen pagination defaults. Print/PDF/XLSX endpoints stay
 * unpaginated — these only chunk the on-screen preview so events with
 * hundreds of athletes don't blow up the DOM.
 */
const PAGE_SIZE_OPTIONS_ROWS = [50, 100, 200, 500] as const;
const PAGE_SIZE_OPTIONS_GROUPS = [5, 10, 20, 50] as const;
const PAGE_SIZE_OPTIONS_CARDS = [9, 18, 36, 72] as const; // multiples of 9 = full A4 pages
const DEFAULTS: Record<Kind, number> = {
  nominal: 100,
  category: 10,
  "id-cards": 36,
  "payment-report": 100,
  fixtures: 5,
  "cash-sheet": 100,
};

function parsePager(
  sp: { page?: string; pageSize?: string },
  kind: Kind,
): { page: number; pageSize: number } {
  const opts =
    kind === "category" || kind === "fixtures"
      ? PAGE_SIZE_OPTIONS_GROUPS
      : kind === "id-cards"
        ? PAGE_SIZE_OPTIONS_CARDS
        : PAGE_SIZE_OPTIONS_ROWS;
  const psRaw = Number.parseInt(sp.pageSize ?? "", 10);
  const pageSize = (opts as readonly number[]).includes(psRaw)
    ? psRaw
    : DEFAULTS[kind];
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  return { page, pageSize };
}

function matchQ(q: string, ...fields: (string | number | null | undefined)[]) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => f != null && String(f).toLowerCase().includes(needle));
}

export default async function PrintPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<{
    q?: string;
    division?: string;
    category?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const { id: idOrSlug, kind } = await params;
  if (!isKind(kind)) notFound();
  const ref = await resolveEventRef(idOrSlug);
  if (!ref) redirect("/admin/events?gone=event");
  const eventId = ref.id;
  const eventSlug = ref.slug;
  const sheet = SHEETS[kind];
  await requireRole("operator", `/admin/events/${eventSlug}/print/${kind}`);

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const division = sp.division ?? "";
  const category = sp.category ?? "";
  const { page, pageSize } = parsePager(sp, kind);
  const basePath = `/admin/events/${eventSlug}/print/${kind}`;
  const linkBase = { path: basePath, params: sp as Record<string, string | undefined> };

  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select("id, name")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) redirect("/admin/events?gone=event");

  const pdfUrl = `/api/pdf/${kind}?event=${eventId}`;
  const xlsxUrl = XLSX_KINDS.has(kind)
    ? `/api/admin/sheets/${kind}?event_id=${eventId}`
    : undefined;

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
          {event.name} · Preview before print
        </p>
        <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
          {sheet.title}
        </h1>
        <p className="mt-1 font-mono text-[13px] text-ink/60">{sheet.blurb}</p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <Link
            href={`/admin/events/${eventSlug}/print`}
            className="font-mono text-[12px] uppercase tracking-[0.2em] underline hover:text-rust"
          >
            ←&nbsp;all sheets
          </Link>
          {kind === "id-cards" && (
            <Link
              href={`/admin/events/${eventSlug}/branding`}
              className="font-mono text-[12px] uppercase tracking-[0.2em] underline hover:text-rust"
            >
              edit ID card branding&nbsp;→
            </Link>
          )}
        </div>
      </div>

      {kind === "nominal" && (
        <Suspense fallback={<PreviewSkeleton />}>
          <NominalPreview eventId={eventId} pdfUrl={pdfUrl} xlsxUrl={xlsxUrl} q={q} division={division} page={page} pageSize={pageSize} linkBase={linkBase} />
        </Suspense>
      )}
      {kind === "category" && (
        <Suspense fallback={<PreviewSkeleton />}>
          <CategoryPreview eventId={eventId} eventSlug={eventSlug} pdfUrl={pdfUrl} xlsxUrl={xlsxUrl} q={q} category={category} page={page} pageSize={pageSize} linkBase={linkBase} />
        </Suspense>
      )}
      {kind === "id-cards" && (
        <Suspense fallback={<PreviewSkeleton />}>
          <IdCardsPreview eventId={eventId} pdfUrl={pdfUrl} xlsxUrl={xlsxUrl} q={q} division={division} page={page} pageSize={pageSize} linkBase={linkBase} />
        </Suspense>
      )}
      {kind === "payment-report" && (
        <Suspense fallback={<PreviewSkeleton />}>
          <PaymentReportPreview eventId={eventId} eventSlug={eventSlug} pdfUrl={pdfUrl} xlsxUrl={xlsxUrl} q={q} page={page} pageSize={pageSize} linkBase={linkBase} />
        </Suspense>
      )}
      {kind === "fixtures" && (
        <Suspense fallback={<PreviewSkeleton />}>
          <FixturesPreview eventId={eventId} eventSlug={eventSlug} pdfUrl={pdfUrl} q={q} category={category} page={page} pageSize={pageSize} linkBase={linkBase} />
        </Suspense>
      )}
      {kind === "cash-sheet" && (
        <Suspense fallback={<PreviewSkeleton />}>
          <CashSheetPreview eventId={eventId} pdfUrl={pdfUrl} q={q} />
        </Suspense>
      )}
    </div>
  );
}

/* ------------------------------ Nominal -------------------------------- */

async function NominalPreview({
  eventId,
  pdfUrl,
  xlsxUrl,
  q,
  division,
  page,
  pageSize,
  linkBase,
}: {
  eventId: string;
  pdfUrl: string;
  xlsxUrl?: string;
  q: string;
  division: string;
  page: number;
  pageSize: number;
  linkBase: { path: string; params?: Record<string, string | undefined> };
}) {
  const svc = createServiceClient();
  const { data } = await svc
    .from("registrations")
    .select(
      "chest_no, full_name, division, district, team, declared_weight_kg, status"
    )
    .eq("event_id", eventId)
    .order("full_name", { ascending: true });

  const all = data ?? [];
  const divisions = Array.from(
    new Set(all.map((r) => r.division).filter(Boolean))
  ) as string[];
  const filtered = all.filter(
    (r) =>
      (!division || r.division === division) &&
      matchQ(q, r.full_name, r.chest_no, r.district, r.team)
  );
  const total = filtered.length;
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <PreviewToolbar
        xlsxUrl={xlsxUrl}
        divisions={divisions}
        totalLabel={`${total} of ${all.length}`}
        zipUrl={`/api/admin/nominal.zip?event_id=${eventId}${
          division ? `&division=${encodeURIComponent(division)}` : ""
        }${q ? `&q=${encodeURIComponent(q)}` : ""}`}
      />
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={total}
        options={PAGE_SIZE_OPTIONS_ROWS}
        itemLabel="athletes"
        linkBase={linkBase}
      />
      <div className="border-2 border-ink">
        <table className="w-full border-collapse font-mono text-[13px]">
          <thead className="bg-ink text-paper">
            <tr>
              <Th>Chest</Th>
              <Th>Name</Th>
              <Th>Division</Th>
              <Th>District</Th>
              <Th>Team</Th>
              <Th className="text-right">Wt (kg)</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={i} className="border-t border-ink/20 even:bg-kraft/10">
                <Td>{r.chest_no ?? "—"}</Td>
                <Td className="font-semibold">{r.full_name}</Td>
                <Td>{r.division ?? "—"}</Td>
                <Td>{r.district ?? "—"}</Td>
                <Td>{r.team ?? "—"}</Td>
                <Td className="text-right">{r.declared_weight_kg ?? "—"}</Td>
                <Td>{r.status}</Td>
              </tr>
            ))}
            {slice.length === 0 && <EmptyRow cols={7} />}
          </tbody>
        </table>
      </div>
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={total}
        options={PAGE_SIZE_OPTIONS_ROWS}
        itemLabel="athletes"
        linkBase={linkBase}
        compact
      />
    </>
  );
}

/* ------------------------------ Category ------------------------------- */

async function CategoryPreview({
  eventId,
  eventSlug,
  pdfUrl,
  xlsxUrl,
  q,
  category,
  page,
  pageSize,
  linkBase,
}: {
  eventId: string;
  eventSlug: string;
  pdfUrl: string;
  xlsxUrl?: string;
  q: string;
  category: string;
  page: number;
  pageSize: number;
  linkBase: { path: string; params?: Record<string, string | undefined> };
}) {
  const svc = createServiceClient();
  // Fetch event metadata, registrations, AND weigh-ins in parallel.
  // Weigh-ins are joined through registrations(event_id) so we don't
  // round-trip a huge IN(registration_id, ...) list — that approach hit
  // PostgREST URL limits and stalled this route for tens of seconds on
  // events with hundreds of athletes.
  const [eventRes, regsRes, sumsRes, wisRes] = await Promise.all([
    svc.from("events").select("starts_at").eq("id", eventId).maybeSingle(),
    svc
      .from("registrations")
      .select(
        "id, chest_no, full_name, district, declared_weight_kg, gender, nonpara_classes, nonpara_hands, nonpara_hand, para_codes, para_hand, weight_overrides, status, lifecycle_status, discipline_status, checkin_status"
      )
      .eq("event_id", eventId),
    svc
      .from("payment_summary")
      .select("registration_id, derived_status")
      .eq("event_id", eventId),
    svc
      .from("weigh_ins")
      .select(
        "registration_id, measured_kg, weighed_at, registrations!inner(event_id)"
      )
      .eq("registrations.event_id", eventId)
      .order("weighed_at", { ascending: false }),
  ]);
  const event = eventRes.data;
  const regs = regsRes.data;
  const wis = wisRes.data ?? [];
  // Two gates: weighed-in (locks the bucket) AND not disqualified.
  // Once on the scale, the athlete is on the on-mat roster unless a
  // referee has DQ'd them.
  const eligibleAll = (regs ?? []).filter(
    (r) =>
      r.checkin_status === "weighed_in" &&
      r.discipline_status !== "disqualified",
  );
  const eligible = eligibleAll.filter(
    (r) => r.gender === "M" || r.gender === "F"
  );
  const latestWi = new Map<string, { measured_kg: number }>();
  for (const w of wis) {
    if (!latestWi.has(w.registration_id)) {
      latestWi.set(w.registration_id, { measured_kg: Number(w.measured_kg) });
    }
  }
  const refYear = event?.starts_at
    ? new Date(event.starts_at).getUTCFullYear()
    : new Date().getUTCFullYear();
  const groupRegs = eligible.map((r) => {
    const lite: RegistrationLite = {
      id: r.id,
      gender: r.gender as "M" | "F",
      declared_weight_kg: Number(r.declared_weight_kg ?? 0),
      nonpara_classes: (r.nonpara_classes as string[] | null) ?? [],
      nonpara_hands:
        (r.nonpara_hands as RegistrationLite["nonpara_hands"]) ??
        ((r.nonpara_classes as string[] | null) ?? []).map(
          () => (r.nonpara_hand as "R" | "L" | "B" | null) ?? null
        ),
      para_codes: (r.para_codes as string[] | null) ?? [],
      para_hand: (r.para_hand as RegistrationLite["para_hand"]) ?? null,
      weight_overrides:
        (r.weight_overrides as RegistrationLite["weight_overrides"]) ?? null,
    };
    return {
      ...lite,
      chest_no: r.chest_no,
      full_name: r.full_name,
      district: r.district,
    };
  });
  const allGroups = groupRegistrationsByCategory(groupRegs, latestWi, refYear);
  const allCats = allGroups.map((g) => g.category_code);
  const cats = allGroups
    .filter((g) => !category || g.category_code === category)
    .map((g) => ({
      code: g.category_code,
      athletes: g.athletes.filter((a) =>
        matchQ(q, a.full_name, a.chest_no, a.district)
      ),
    }))
    .filter((c) => c.athletes.length > 0 || !q);

  const total = cats.reduce((n, c) => n + c.athletes.length, 0);
  const totalGroups = cats.length;
  const sliced = cats.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <PreviewToolbar
        pdfUrl={pdfUrl}
        xlsxUrl={xlsxUrl}
        categories={allCats}
        totalLabel={`${total} athletes · ${totalGroups} categories`}
      />
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={totalGroups}
        options={PAGE_SIZE_OPTIONS_GROUPS}
        itemLabel="categories"
        linkBase={linkBase}
      />
      <div className="space-y-4">
        {sliced.map((c) => (
          <div
            key={c.code}
            data-category-section={c.code}
            className="border-2 border-ink"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-ink px-3 py-2 text-paper">
              <div className="flex items-baseline gap-2">
                <p className="font-display text-lg font-black tracking-tight">
                  {formatCategoryCode(c.code)}
                </p>
                <span className="border border-paper/40 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.15em] text-paper/80">
                  {c.code}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-mono text-[12px] uppercase tracking-[0.2em]">
                  {c.athletes.length} athletes
                </p>
                <CategorySectionActions
                  sectionId={c.code}
                  filename={`${eventSlug}-category-${slugifyCategory(formatCategoryCode(c.code))}`}
                  headers={["Chest", "Name", "District"]}
                  rows={c.athletes.map((a) => [
                    a.chest_no != null ? String(a.chest_no) : "",
                    a.full_name ?? "",
                    a.district ?? "",
                  ])}
                />
              </div>
            </div>
            <table className="w-full border-collapse font-mono text-[13px]">
              <thead className="bg-kraft/30">
                <tr>
                  <Th>Chest</Th>
                  <Th>Name</Th>
                  <Th>District</Th>
                </tr>
              </thead>
              <tbody>
                {c.athletes.map((a, i) => (
                  <tr key={i} className="border-t border-ink/10 even:bg-kraft/5">
                    <Td>{a.chest_no ?? "—"}</Td>
                    <Td className="font-semibold">{a.full_name ?? "—"}</Td>
                    <Td>{a.district ?? "—"}</Td>
                  </tr>
                ))}
                {c.athletes.length === 0 && <EmptyRow cols={3} />}
              </tbody>
            </table>
          </div>
        ))}
        {cats.length === 0 && (
          <p className="border-2 border-dashed border-ink/30 p-6 text-center font-mono text-[13px] text-ink/50">
            No matching categories.
          </p>
        )}
      </div>
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={totalGroups}
        options={PAGE_SIZE_OPTIONS_GROUPS}
        itemLabel="categories"
        linkBase={linkBase}
        compact
      />
    </>
  );
}

/* ------------------------------ ID Cards ------------------------------- */

async function IdCardsPreview({
  eventId,
  pdfUrl,
  xlsxUrl,
  q,
  division,
  page,
  pageSize,
  linkBase,
}: {
  eventId: string;
  pdfUrl: string;
  xlsxUrl?: string;
  q: string;
  division: string;
  page: number;
  pageSize: number;
  linkBase: { path: string; params?: Record<string, string | undefined> };
}) {
  const svc = createServiceClient();
  const { data } = await svc
    .from("registrations")
    .select(
      "id, chest_no, full_name, division, district, team, declared_weight_kg, photo_url"
    )
    .eq("event_id", eventId)
    .order("chest_no", { ascending: true, nullsFirst: false });

  const all = data ?? [];
  const divisions = Array.from(
    new Set(all.map((r) => r.division).filter(Boolean))
  ) as string[];
  const filtered = all.filter(
    (r) =>
      (!division || r.division === division) &&
      matchQ(q, r.full_name, r.chest_no, r.district, r.team)
  );
  const total = filtered.length;
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Photos are stored as private R2 keys; resolve to short-lived signed
  // URLs so the on-screen preview actually shows the pictures the PDF
  // will print. Failures are silent - the placeholder box still renders.
  // Only sign URLs for the visible page — 600 signed-URL hits per page
  // load was a real cost on big events.
  const rows = await Promise.all(
    slice.map(async (r) => {
      let signed: string | null = null;
      if (r.photo_url) {
        if (/^https?:\/\//i.test(r.photo_url)) {
          signed = r.photo_url;
        } else {
          try {
            signed = await signedUrl(r.photo_url, 600);
          } catch {
            signed = null;
          }
        }
      }
      return { ...r, photo_url: signed };
    }),
  );

  return (
    <>
      <PreviewToolbar
        pdfUrl={pdfUrl}
        xlsxUrl={xlsxUrl}
        divisions={divisions}
        totalLabel={`${total} cards · ${Math.ceil(total / 9)} A4 pages`}
      />
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={total}
        options={PAGE_SIZE_OPTIONS_CARDS}
        itemLabel="cards"
        linkBase={linkBase}
      />
      <IdCardsGrid eventId={eventId} rows={rows} />
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={total}
        options={PAGE_SIZE_OPTIONS_CARDS}
        itemLabel="cards"
        linkBase={linkBase}
        compact
      />
    </>
  );
}

/* ------------------------------ Fixtures ------------------------------- */

async function FixturesPreview({
  eventId,
  eventSlug,
  pdfUrl,
  q,
  category,
  page,
  pageSize,
  linkBase,
}: {
  eventId: string;
  eventSlug: string;
  pdfUrl: string;
  q: string;
  category: string;
  page: number;
  pageSize: number;
  linkBase: { path: string; params?: Record<string, string | undefined> };
}) {
  const svc = createServiceClient();
  const { data } = await svc
    .from("fixtures")
    .select(
      "category_code, bracket_side, round_no, match_no, best_of, entry_a:entry_a_id(registrations(chest_no, full_name)), entry_b:entry_b_id(registrations(chest_no, full_name))"
    )
    .eq("event_id", eventId)
    .order("category_code", { ascending: true })
    .order("bracket_side", { ascending: true })
    .order("round_no", { ascending: true })
    .order("match_no", { ascending: true });

  function label(entry: unknown): string | null {
    const e = Array.isArray(entry) ? entry[0] : entry;
    const reg =
      e && typeof e === "object"
        ? (e as { registrations?: unknown }).registrations
        : null;
    const r = Array.isArray(reg) ? reg[0] : reg;
    if (!r || typeof r !== "object") return null;
    const { chest_no, full_name } = r as {
      chest_no?: number | null;
      full_name?: string | null;
    };
    if (!full_name) return null;
    return chest_no != null ? `${chest_no} ${full_name}` : full_name;
  }

  type Side = "W" | "L" | "GF";
  type Match = {
    side: Side;
    round_no: number;
    match_no: number;
    a: string | null;
    b: string | null;
    best_of: number;
  };
  const byCat = new Map<string, Match[]>();
  for (const f of data ?? []) {
    if (!byCat.has(f.category_code)) byCat.set(f.category_code, []);
    byCat.get(f.category_code)!.push({
      side: ((f.bracket_side as Side | null) ?? "W") as Side,
      round_no: f.round_no,
      match_no: f.match_no,
      a: label(f.entry_a),
      b: label(f.entry_b),
      best_of: (f.best_of as number | null) ?? 1,
    });
  }

  /**
   * R1 of the winners' bracket is the ONLY place an empty slot is a real
   * bye (bracket padded up to the next power of two). Everywhere else a
   * null slot is just a future match waiting for an upstream winner.
   */
  function slotLabel(m: Match, value: string | null): string {
    if (value) return value;
    if (m.side === "W" && m.round_no === 1) return "BYE";
    return "TBD";
  }

  const allCats = Array.from(byCat.keys()).sort();
  const cats = allCats
    .filter((c) => !category || c === category)
    .map((c) => ({
      code: c,
      matches: byCat.get(c)!.filter((m) =>
        matchQ(q, slotLabel(m, m.a), slotLabel(m, m.b))
      ),
    }))
    .filter((c) => c.matches.length > 0 || !q);

  const SIDE_ORDER: Record<Side, number> = { W: 0, L: 1, GF: 2 };
  const SIDE_LABEL: Record<Side, string> = {
    W: "Winners' Bracket",
    L: "Losers' Bracket",
    GF: "Grand Final",
  };

  return (
    <>
      <PreviewToolbar
        pdfUrl={pdfUrl}
        categories={allCats}
        totalLabel={`${cats.reduce((n, c) => n + c.matches.length, 0)} matches · ${cats.length} categories`}
      />
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={cats.length}
        options={PAGE_SIZE_OPTIONS_GROUPS}
        itemLabel="categories"
        linkBase={linkBase}
      />
      <p className="mb-3 border-l-4 border-ink bg-kraft/30 px-3 py-2 font-mono text-[13px] text-ink/70 print:bg-transparent">
        Offline run-of-show: tick the winner&apos;s box, write the advancing
        name on the dashed line of the next round&apos;s match card, sign on the
        Ref line. BYE = athlete advances automatically; TBD lines fill as the
        bracket progresses.
      </p>
      <div className="space-y-4">
        {cats.slice((page - 1) * pageSize, page * pageSize).map((c) => {
          // Group: side -> round -> matches.
          const bySide = new Map<Side, Map<number, Match[]>>();
          for (const m of c.matches) {
            if (!bySide.has(m.side)) bySide.set(m.side, new Map());
            const roundMap = bySide.get(m.side)!;
            if (!roundMap.has(m.round_no)) roundMap.set(m.round_no, []);
            roundMap.get(m.round_no)!.push(m);
          }
          const sides = Array.from(bySide.entries()).sort(
            ([a], [b]) => SIDE_ORDER[a] - SIDE_ORDER[b]
          );
          return (
            <div
              key={c.code}
              data-category-section={c.code}
              className="border-2 border-ink"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-ink px-3 py-2 text-paper">
                <div className="flex items-baseline gap-2">
                  <p className="font-display text-lg font-black tracking-tight">
                    {formatCategoryCode(c.code)}
                  </p>
                  <span className="border border-paper/40 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.15em] text-paper/80">
                    {c.code}
                  </span>
                </div>
                <CategorySectionActions
                  sectionId={c.code}
                  filename={`${eventSlug}-fixtures-${slugifyCategory(formatCategoryCode(c.code))}`}
                  headers={["Bracket", "Round", "Match", "Side A", "Side B"]}
                  rows={c.matches.map((m) => [
                    m.side,
                    String(m.round_no),
                    String(m.match_no),
                    slotLabel(m, m.a),
                    slotLabel(m, m.b),
                  ])}
                />
              </div>
              <div className="space-y-3 p-3">
                {sides.map(([side, byRound]) => {
                  const rounds = Array.from(byRound.entries()).sort(
                    ([a], [b]) => a - b
                  );
                  return (
                    <section key={side}>
                      <p className="mb-2 border-b border-ink/40 pb-1 font-mono text-[12px] uppercase tracking-[0.2em] text-ink/70">
                        {SIDE_LABEL[side]}
                      </p>
                      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {rounds.map(([round_no, matches]) => (
                          <div key={round_no} className="border border-ink/40">
                            <p className="border-b border-ink/40 bg-kraft/30 px-2 py-1 font-mono text-[12px] uppercase tracking-[0.2em]">
                              {side === "GF" ? "Grand Final" : `Round ${round_no}`}
                            </p>
                            <div className="divide-y divide-ink/10 font-mono text-[13px]">
                              {matches.map((m) => {
                                // Round 1 of W is the only place a missing
                                // slot is a real bye. Everywhere else it's a
                                // pending slot — render a fillable line so the
                                // ref can write the advancing name in pen.
                                const isR1W = m.side === "W" && m.round_no === 1;
                                const renderSlot = (
                                  letter: "A" | "B",
                                  value: string | null
                                ) => (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[12px] text-ink/40">
                                      {letter}
                                    </span>
                                    <span
                                      className="inline-block h-3 w-3 border border-ink"
                                      aria-hidden
                                    />
                                    {value ? (
                                      <span className="flex-1">{value}</span>
                                    ) : isR1W ? (
                                      <span className="flex-1 text-ink/50">BYE</span>
                                    ) : (
                                      <span className="flex-1 border-b border-dashed border-ink/60 pb-1">
                                        &nbsp;
                                      </span>
                                    )}
                                  </div>
                                );
                                return (
                                  <div key={m.match_no} className="space-y-1 px-2 py-2">
                                    <div className="flex items-baseline justify-between text-[12px] text-ink/50">
                                      <span className="font-bold text-ink">
                                        M{m.match_no}
                                      </span>
                                      <span>Time ___:___</span>
                                    </div>
                                    {renderSlot("A", m.a)}
                                    {renderSlot("B", m.b)}
                                    {m.best_of > 1 ? (
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink/10 pt-1 text-[12px] text-ink/60">
                                        <span className="font-bold text-ink">
                                          BEST OF {m.best_of}
                                        </span>
                                        {Array.from({ length: m.best_of }).map((_, gi) => (
                                          <span
                                            key={gi}
                                            className="inline-flex items-center gap-1"
                                          >
                                            <span className="text-ink/50">G{gi + 1}</span>
                                            <span className="text-ink/40">A</span>
                                            <span
                                              className="inline-block h-2.5 w-2.5 border border-ink"
                                              aria-hidden
                                            />
                                            <span className="text-ink/40">B</span>
                                            <span
                                              className="inline-block h-2.5 w-2.5 border border-ink"
                                              aria-hidden
                                            />
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                    <div className="flex items-center gap-2 border-t border-ink/10 pt-1 text-[12px] text-ink/50">
                                      <span>Ref</span>
                                      <span className="flex-1 border-b border-dashed border-ink/40">
                                        &nbsp;
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          );
        })}
        {cats.length === 0 && (
          <p className="border-2 border-dashed border-ink/30 p-6 text-center font-mono text-[13px] text-ink/50">
            No fixtures match your filters.
          </p>
        )}
      </div>
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={cats.length}
        options={PAGE_SIZE_OPTIONS_GROUPS}
        itemLabel="categories"
        linkBase={linkBase}
        compact
      />
    </>
  );
}


/* --------------------------- Payment Report ---------------------------- */

async function PaymentReportPreview({
  eventId,
  eventSlug,
  pdfUrl,
  xlsxUrl,
  q,
  page,
  pageSize,
  linkBase,
}: {
  eventId: string;
  eventSlug: string;
  pdfUrl: string;
  xlsxUrl?: string;
  q: string;
  page: number;
  pageSize: number;
  linkBase: { path: string; params?: Record<string, string | undefined> };
}) {
  const svc = createServiceClient();
  const { rows, totals } = await loadPaymentReport(svc, eventId);
  // Per-district money + headcount: shown here (replaces old "Pending
  // Dues" sheet). Re-uses event_dashboard RPC so the figures match the
  // operator console exactly.
  const { data: dash } = await svc.rpc("event_dashboard", {
    p_id_or_slug: eventId,
  });
  const districts =
    (dash as { districts?: DistrictTotal[] } | null)?.districts ?? [];
  const filtered = rows.filter((r) =>
    matchQ(q, r.full_name, r.chest_no, r.team_or_district, r.category)
  );
  const total = filtered.length;
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <PreviewToolbar
        pdfUrl={pdfUrl}
        xlsxUrl={xlsxUrl}
        totalLabel={`${totals.total_athletes} athletes · ${Math.round(totals.percent_paid)}% collected · ₹${totals.total_due.toLocaleString(
          "en-IN"
        )} due${totals.total_waived ? ` · ₹${totals.total_waived.toLocaleString("en-IN")} waived (${totals.waived_n})` : ""}`}
      />
      <div className="grid gap-2 md:grid-cols-5">
        <SummaryCard label="Athletes" value={String(totals.total_athletes)} />
        <SummaryCard
          label="Received"
          value={`₹${totals.total_received.toLocaleString("en-IN")}`}
          tone="paid"
        />
        <SummaryCard
          label={`Waived${totals.waived_n ? ` (${totals.waived_n})` : ""}`}
          value={`₹${totals.total_waived.toLocaleString("en-IN")}`}
        />
        <SummaryCard
          label="Due"
          value={`₹${totals.total_due.toLocaleString("en-IN")}`}
          tone="due"
        />
        <SummaryCard label="% Collected" value={`${Math.round(totals.percent_paid)}%`} />
      </div>
      {districts.length > 0 && (
        <DistrictSummary eventSlug={eventSlug} totals={districts} />
      )}
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={total}
        options={PAGE_SIZE_OPTIONS_ROWS}
        itemLabel="athletes"
        linkBase={linkBase}
      />
      <div className="border-2 border-ink">
        <table className="w-full border-collapse font-mono text-[13px]">
          <thead className="bg-ink text-paper">
            <tr>
              <Th>Chest</Th>
              <Th>Athlete</Th>
              <Th>Team / District</Th>
              <Th>Category</Th>
              <Th className="text-right">Total (₹)</Th>
              <Th className="text-right">Recv (₹)</Th>
              <Th className="text-right">Waived (₹)</Th>
              <Th className="text-right">Due (₹)</Th>
              <Th>Paid by</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={i} className="border-t border-ink/20 even:bg-kraft/10">
                <Td>{r.chest_no ?? "—"}</Td>
                <Td className="font-semibold">{r.full_name}</Td>
                <Td>{r.team_or_district ?? "—"}</Td>
                <Td>{r.category ?? "—"}</Td>
                <Td className="text-right">
                  {r.total_inr ? r.total_inr.toLocaleString("en-IN") : "—"}
                </Td>
                <Td className="text-right">
                  {r.received_inr ? r.received_inr.toLocaleString("en-IN") : "—"}
                </Td>
                <Td className="text-right">
                  {r.waived_inr ? r.waived_inr.toLocaleString("en-IN") : "—"}
                </Td>
                <Td className="text-right">
                  {r.due_inr ? r.due_inr.toLocaleString("en-IN") : "—"}
                </Td>
                <Td>{r.paid_by ?? "—"}</Td>
              </tr>
            ))}
            {slice.length === 0 && <EmptyRow cols={9} />}
            {filtered.length > 0 && (
              <tr className="border-t-2 border-ink bg-volt/30 font-bold">
                <Td colSpan={4} className="text-right uppercase tracking-[0.2em]">
                  Grand Total (all {filtered.length})
                </Td>
                <Td className="text-right">
                  ₹{totals.total_billable.toLocaleString("en-IN")}
                </Td>
                <Td className="text-right">
                  ₹{totals.total_received.toLocaleString("en-IN")}
                </Td>
                <Td className="text-right">
                  ₹{totals.total_waived.toLocaleString("en-IN")}
                </Td>
                <Td className="text-right">
                  ₹{totals.total_due.toLocaleString("en-IN")}
                </Td>
                <Td>—</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PreviewPager
        page={page}
        pageSize={pageSize}
        total={total}
        options={PAGE_SIZE_OPTIONS_ROWS}
        itemLabel="athletes"
        linkBase={linkBase}
        compact
      />
    </>
  );
}

/* ------------------------- Cash Collection ----------------------------- */

/**
 * Cover-page preview for the per-district cash sheet PDF. Mirrors the
 * cover totals from CashCollectionSheet so the operator can sanity-check
 * district totals before printing the per-district pages.
 */
async function CashSheetPreview({
  eventId,
  pdfUrl,
  q,
}: {
  eventId: string;
  pdfUrl: string;
  q: string;
}) {
  const svc = createServiceClient();
  // Use payment_summary view (single source of truth defined in
  // migration 0028) so partial collections are counted correctly. The
  // legacy query summed amount_inr filtered by status='verified' and
  // mis-reported partials as ₹0 paid / full ₹ pending.
  const { data: sums } = await svc
    .from("payment_summary")
    .select("registration_id, total_inr, collected_inr, derived_status")
    .eq("event_id", eventId)
    .neq("derived_status", "rejected");
  const regIds = (sums ?? [])
    .map((s) => s.registration_id as string)
    .filter(Boolean);
  const { data: regs } = await svc
    .from("registrations")
    .select("id, district")
    .in(
      "id",
      regIds.length ? regIds : ["00000000-0000-0000-0000-000000000000"]
    );
  const districtByReg = new Map(
    (regs ?? []).map((r) => [r.id as string, (r.district as string | null) ?? null])
  );

  type Row = { district: string; athletes: number; expected: number; paid: number };
  const byDistrict = new Map<string, Row>();
  for (const s of sums ?? []) {
    const d = districtByReg.get(s.registration_id as string) ?? "(no district)";
    const cur = byDistrict.get(d) ?? { district: d, athletes: 0, expected: 0, paid: 0 };
    cur.athletes += 1;
    cur.expected += Number(s.total_inr ?? 0);
    cur.paid += Number(s.collected_inr ?? 0);
    byDistrict.set(d, cur);
  }
  const rows = Array.from(byDistrict.values())
    .filter((r) => matchQ(q, r.district))
    .sort((a, b) => a.district.localeCompare(b.district));
  const grand = rows.reduce(
    (acc, r) => ({
      athletes: acc.athletes + r.athletes,
      expected: acc.expected + r.expected,
      paid: acc.paid + r.paid,
    }),
    { athletes: 0, expected: 0, paid: 0 }
  );

  return (
    <>
      <PreviewToolbar
        pdfUrl={pdfUrl}
        totalLabel={`${rows.length} district${rows.length === 1 ? "" : "s"} · ${grand.athletes} athletes · ₹${grand.expected.toLocaleString(
          "en-IN"
        )} expected`}
      />
      <div className="border-2 border-ink">
        <table className="w-full border-collapse font-mono text-[13px]">
          <thead className="bg-ink text-paper">
            <tr>
              <Th>District</Th>
              <Th className="text-right">Athletes</Th>
              <Th className="text-right">Expected (₹)</Th>
              <Th className="text-right">Collected (₹)</Th>
              <Th className="text-right">Pending (₹)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.district} className="border-t border-ink/20 even:bg-kraft/10">
                <Td className="font-semibold">{r.district}</Td>
                <Td className="text-right">{r.athletes}</Td>
                <Td className="text-right">{r.expected.toLocaleString("en-IN")}</Td>
                <Td className="text-right">{r.paid.toLocaleString("en-IN")}</Td>
                <Td className="text-right">
                  {(r.expected - r.paid).toLocaleString("en-IN")}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow cols={5} />}
            {rows.length > 0 && (
              <tr className="border-t-2 border-ink bg-volt/30 font-bold">
                <Td className="uppercase tracking-[0.2em]">Grand Total</Td>
                <Td className="text-right">{grand.athletes}</Td>
                <Td className="text-right">
                  ₹{grand.expected.toLocaleString("en-IN")}
                </Td>
                <Td className="text-right">
                  ₹{grand.paid.toLocaleString("en-IN")}
                </Td>
                <Td className="text-right">
                  ₹{(grand.expected - grand.paid).toLocaleString("en-IN")}
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[12px] text-ink/60">
        The PDF includes a separate page per district with athlete names,
        chest #, fee and a signature column for the District Convener.
      </p>
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "paid" | "due";
}) {
  const toneCls =
    tone === "paid"
      ? "bg-volt/20"
      : tone === "due"
        ? "bg-rust/10"
        : "bg-kraft/20";
  return (
    <div className={`border-2 border-ink p-3 ${toneCls}`}>
      <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/60">
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-black">{value}</p>
    </div>
  );
}

/* ------------------------------- Atoms --------------------------------- */

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-2 py-1.5 text-left font-mono text-[12px] uppercase tracking-[0.15em] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-2 py-1.5 align-top ${className}`}>
      {children}
    </td>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td
        colSpan={cols}
        className="px-2 py-6 text-center font-mono text-[13px] text-ink/50"
      >
        No rows match your filters.
      </td>
    </tr>
  );
}

function PreviewSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-10 animate-pulse border-2 border-ink/20 bg-kraft/10" />
      <div className="h-32 animate-pulse border-2 border-ink/20 bg-kraft/10" />
      <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-ink/50">
        loading sheet…
      </p>
    </div>
  );
}

/**
 * On-screen-only pager. Hidden from print + the official PDF/XLSX
 * exports so the printable artefact still contains the full set of
 * rows. Wraps the shared admin Pagination in link-mode.
 */
function PreviewPager({
  page,
  pageSize,
  total,
  options,
  itemLabel,
  linkBase,
  compact = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  options: readonly number[];
  itemLabel: string;
  linkBase: { path: string; params?: Record<string, string | undefined> };
  compact?: boolean;
}) {
  if (total <= pageSize && page === 1) return null;
  return (
    <div className="print:hidden">
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        options={options}
        itemLabel={itemLabel}
        compact={compact}
        linkBase={linkBase}
      />
    </div>
  );
}

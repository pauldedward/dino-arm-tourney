import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { NominalSheet, type NominalRow } from "@/lib/pdf/NominalSheet";
import { CategorySheet, type CategoryRow } from "@/lib/pdf/CategorySheet";
import { IdCardSheet, type IdRow } from "@/lib/pdf/IdCardSheet";
import { FixturesSheet, type FixtureRow } from "@/lib/pdf/FixturesSheet";
import { CashCollectionSheet, type CashDistrict } from "@/lib/pdf/CashCollectionSheet";
import { PaymentReportSheet } from "@/lib/pdf/PaymentReportSheet";
import { loadPaymentReport } from "@/lib/sheets/loaders";
import { recordAudit } from "@/lib/audit";
import { groupRegistrationsByCategory } from "@/lib/registrations/group-by-category";
import { isPaid, isWeighed } from "@/lib/payments/status";
import { isFixtureEligible } from "@/lib/registrations/eligibility";
import type { RegistrationLite } from "@/lib/rules/resolve";
import { exportFilename } from "@/lib/export/filename";

import { getObjectBytes } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "nominal" | "category" | "id-cards" | "fixtures" | "cash-sheet" | "payment-report";

/**
 * POST /api/pdf/[kind]?event=<id>
 *
 * Streams the chosen PDF. Data fetching is centralised here so each
 * React-PDF component stays pure. All branding fields come from the
 * events row (C6).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string }> }
) {
  const session = await requireRole("operator", "/admin");
  const { kind } = await params;
  if (!isKind(kind)) return new Response("unknown kind", { status: 400 });
  const eventId = req.nextUrl.searchParams.get("event") ?? "";
  if (!eventId) return new Response("event required", { status: 400 });

  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select(
      "id, name, slug, starts_at, primary_color, accent_color, text_on_primary, logo_url, id_card_org_name, id_card_event_title, id_card_subtitle, id_card_footer, id_card_signatory_name, id_card_signatory_title, id_card_signature_url, id_card_org_name_size, id_card_event_title_size"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return new Response("event not found", { status: 404 });

  const doc = await buildDocument(kind, svc, event, req);
  if (!doc) return new Response("unknown kind", { status: 400 });

  await recordAudit({
    eventId,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: `pdf.${kind}`,
    payload: { event_id: eventId },
  });

  const stream = await renderToStream(doc);
  const filename = exportFilename({
    eventSlug: (event as { slug?: string | null }).slug,
    eventName: event.name,
    kind,
    ext: "pdf",
  });
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

// GET is a convenience alias so PDFs open in a new tab.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string }> }
) {
  return POST(req, ctx);
}

function isKind(k: string): k is Kind {
  return (
    k === "nominal" ||
    k === "category" ||
    k === "id-cards" ||
    k === "fixtures" ||
    k === "cash-sheet" ||
    k === "payment-report"
  );
}

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  primary_color: string | null;
  accent_color: string | null;
  text_on_primary: string | null;
  logo_url: string | null;
  id_card_org_name: string | null;
  id_card_event_title: string | null;
  id_card_subtitle: string | null;
  id_card_footer: string | null;
  id_card_signatory_name: string | null;
  id_card_signatory_title: string | null;
  id_card_org_name_size: number | null;
  id_card_event_title_size: number | null;
};

async function buildDocument(
  kind: Kind,
  svc: ReturnType<typeof createServiceClient>,
  event: EventRow,
  req: NextRequest,
) {
  switch (kind) {
    case "nominal": {
      const { data } = await svc
        .from("registrations")
        .select(
          "id, chest_no, full_name, division, district, team, declared_weight_kg, age_categories, status, payments(status), weigh_ins(id)"
        )
        .eq("event_id", event.id)
        .order("full_name", { ascending: true });
      const rows: NominalRow[] = (data ?? []).map((r) => {
        const ps = Array.isArray(r.payments) ? r.payments : [];
        const ws = Array.isArray(r.weigh_ins) ? r.weigh_ins : [];
        return {
          chest_no: r.chest_no,
          full_name: r.full_name,
          division: r.division,
          district: r.district,
          team: r.team,
          declared_weight_kg: r.declared_weight_kg,
          age_categories: r.age_categories as string[] | null,
          status: r.status,
          paid: isPaid(r.status, ps),
          weighed: isWeighed(r.status, ws),
        };
      });
      return <NominalSheet event={{ name: event.name }} rows={rows} />;
    }

    case "category": {
      // Build category groupings directly from registrations + latest
      // weigh-ins (mirrors `/api/fixtures/generate`). This is independent
      // of the `entries` table so the sheet works at any point in the
      // event lifecycle, including for categories with a single athlete
      // (which never produce fixture rows).
      // Pull all registrations + the installment-aware payment
      // snapshot together. The legacy filter `.in("status",["paid",
      // "weighed_in"])` silently excluded athletes who completed payment
      // via collections (their `registrations.status` stays `pending`
      // even though `payment_summary.derived_status` is `verified`).
      // We now compute eligibility in JS via `isFixtureEligible`.
      const [regsRes, sumsRes] = await Promise.all([
        svc
          .from("registrations")
          .select(
            "id, chest_no, full_name, district, declared_weight_kg, gender, nonpara_classes, nonpara_hands, nonpara_hand, para_codes, para_hand, status, checkin_status"
          )
          .eq("event_id", event.id),
        svc
          .from("payment_summary")
          .select("registration_id, derived_status")
          .eq("event_id", event.id),
      ]);
      const derivedByReg = new Map<string, string>();
      for (const s of sumsRes.data ?? []) {
        derivedByReg.set(
          s.registration_id as string,
          s.derived_status as string,
        );
      }
      const eligibleAll = (regsRes.data ?? []).filter((r) =>
        isFixtureEligible({
          regStatus: r.status,
          derivedPaymentStatus: derivedByReg.get(r.id as string) ?? null,
          checkinStatus: r.checkin_status as string | null | undefined,
        }),
      );
      const eligible = eligibleAll.filter(
        (r) => r.gender === "M" || r.gender === "F"
      );
      const regIds = eligible.map((r) => r.id);
      const { data: wis } = regIds.length
        ? await svc
            .from("weigh_ins")
            .select("registration_id, measured_kg, weighed_at")
            .in("registration_id", regIds)
            .order("weighed_at", { ascending: false })
        : { data: [] as { registration_id: string; measured_kg: number }[] };
      const latestWi = new Map<string, { measured_kg: number }>();
      for (const w of wis ?? []) {
        if (!latestWi.has(w.registration_id)) {
          latestWi.set(w.registration_id, { measured_kg: Number(w.measured_kg) });
        }
      }
      const refYear = event.starts_at
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
        };
        return {
          ...lite,
          chest_no: r.chest_no,
          full_name: r.full_name,
          district: r.district,
        };
      });
      const categories: CategoryRow[] = groupRegistrationsByCategory(
        groupRegs,
        latestWi,
        refYear
      );
      return <CategorySheet event={{ name: event.name }} categories={categories} />;
    }

    case "id-cards": {
      // Optional `ids=<uuid>,<uuid>,…` narrows the print to just those
      // registrations so operators can re-print a single missing/lost
      // card without re-running the whole 9-up sheet. Order is preserved
      // by chest_no for predictable layout.
      const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
      const ids = idsParam
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      let q = svc
        .from("registrations")
        .select(
          "chest_no, full_name, division, district, team, declared_weight_kg, photo_url, nonpara_classes, para_codes"
        )
        .eq("event_id", event.id);
      if (ids.length > 0) q = q.in("id", ids);
      const { data } = await q.order("chest_no", {
        ascending: true,
        nullsFirst: false,
      });
      const baseRows = data ?? [];
      // Resolve athlete photos to data URIs in parallel so react-pdf
      // never has to hit the private R2 bucket itself. Failures are
      // soft - we just fall back to the empty placeholder box.
      const rows: IdRow[] = await Promise.all(
        baseRows.map(async (r) => ({
          chest_no: r.chest_no,
          full_name: r.full_name,
          division: r.division,
          district: r.district,
          team: r.team,
          declared_weight_kg: r.declared_weight_kg,
          nonpara_classes: (r.nonpara_classes as string[] | null) ?? [],
          para_codes: (r.para_codes as string[] | null) ?? [],
          photo_src: await resolvePhotoSrc(r.photo_url),
        })),
      );
      const logo_src = await resolveLogoSrc(event.logo_url);
      return <IdCardSheet event={{ ...event, logo_src }} rows={rows} />;
    }

    case "fixtures": {
      const { data } = await svc
        .from("fixtures")
        .select(
          "category_code, bracket_side, round_no, match_no, best_of, entry_a:entry_a_id(registrations(chest_no, full_name)), entry_b:entry_b_id(registrations(chest_no, full_name))"
        )
        .eq("event_id", event.id)
        .order("category_code", { ascending: true })
        .order("bracket_side", { ascending: true })
        .order("round_no", { ascending: true })
        .order("match_no", { ascending: true });

      type R = NonNullable<typeof data>[number];
      const byCat = new Map<string, R[]>();
      for (const f of data ?? []) {
        if (!byCat.has(f.category_code)) byCat.set(f.category_code, []);
        byCat.get(f.category_code)!.push(f);
      }
      // Render order is W, L, GF regardless of insertion order.
      const SIDE_ORDER: Record<string, number> = { W: 0, L: 1, GF: 2 };
      const categories: FixtureRow[] = Array.from(byCat.entries()).map(
        ([category_code, matches]) => {
          const bySide = new Map<string, R[]>();
          for (const m of matches) {
            const side = (m.bracket_side as string | null) ?? "W";
            if (!bySide.has(side)) bySide.set(side, []);
            bySide.get(side)!.push(m);
          }
          const sides: FixtureRow["sides"] = Array.from(bySide.entries())
            .sort(
              ([a], [b]) => (SIDE_ORDER[a] ?? 99) - (SIDE_ORDER[b] ?? 99)
            )
            .map(([side, list]) => {
              const byRound = new Map<number, FixtureRow["sides"][number]["rounds"][number]["matches"]>();
              for (const m of list) {
                if (!byRound.has(m.round_no)) byRound.set(m.round_no, []);
                byRound.get(m.round_no)!.push({
                  match_no: m.match_no,
                  a: labelOf(m.entry_a),
                  b: labelOf(m.entry_b),
                  best_of: (m.best_of as number | null) ?? 1,
                });
              }
              const rounds = Array.from(byRound.entries())
                .sort(([a], [b]) => a - b)
                .map(([round_no, ms]) => ({ round_no, matches: ms }));
              return { side: side as "W" | "L" | "GF", rounds };
            });
          return { category_code, sides };
        }
      );
      return <FixturesSheet event={{ name: event.name }} categories={categories} />;
    }

    case "cash-sheet": {
      // Pull the installment-aware snapshot from the payment_summary
      // view (the single source of truth, defined in migration 0028).
      // We exclude rejected payments — same as before. The view gives
      // us collected_inr per payment so the sheet can show "Partial"
      // when an athlete is paying in installments.
      const { data: sums } = await svc
        .from("payment_summary")
        .select("registration_id, total_inr, collected_inr, derived_status")
        .eq("event_id", event.id)
        .neq("derived_status", "rejected");
      const regIds = (sums ?? [])
        .map((s) => s.registration_id as string)
        .filter(Boolean);
      const safeRegIds = regIds.length
        ? regIds
        : ["00000000-0000-0000-0000-000000000000"];
      const [{ data: regs }, { data: pays }] = await Promise.all([
        svc
          .from("registrations")
          .select("id, chest_no, full_name, district")
          .in("id", safeRegIds),
        svc
          .from("payments")
          .select("registration_id, method")
          .in("registration_id", safeRegIds),
      ]);
      const regById = new Map(
        (regs ?? []).map((r) => [r.id as string, r])
      );
      const methodByReg = new Map(
        (pays ?? []).map((p) => [
          p.registration_id as string,
          (p.method as string | null) ?? null,
        ])
      );
      const byDistrict = new Map<string, CashDistrict["athletes"]>();
      for (const s of sums ?? []) {
        const reg = regById.get(s.registration_id as string);
        const district = reg?.district ?? "(no district)";
        if (!byDistrict.has(district)) byDistrict.set(district, []);
        byDistrict.get(district)!.push({
          chest_no: reg?.chest_no ?? null,
          full_name: reg?.full_name ?? null,
          amount_inr: Number(s.total_inr ?? 0),
          paid_inr: Number(s.collected_inr ?? 0),
          status: s.derived_status as "pending" | "verified" | "rejected",
          method: methodByReg.get(s.registration_id as string) ?? null,
        });
      }
      const districts: CashDistrict[] = Array.from(byDistrict.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([district, athletes]) => ({
          district,
          // Chest-number sorted within district so DC reads top-to-bottom.
          athletes: athletes.sort(
            (a, b) => (a.chest_no ?? 9e9) - (b.chest_no ?? 9e9)
          ),
        }));
      return (
        <CashCollectionSheet
          event={{ name: event.name, starts_at: event.starts_at }}
          districts={districts}
        />
      );
    }

    case "payment-report": {
      const { rows, totals } = await loadPaymentReport(svc, event.id);
      return (
        <PaymentReportSheet event={{ name: event.name }} rows={rows} totals={totals} />
      );
    }
  }
  return null;
}

function labelOf(entry: unknown): string | null {
  const e = Array.isArray(entry) ? entry[0] : entry;
  if (!e || typeof e !== "object") return null;
  const reg = (e as { registrations?: unknown }).registrations;
  const r = Array.isArray(reg) ? reg[0] : reg;
  if (!r || typeof r !== "object") return null;
  const { chest_no, full_name } = r as { chest_no?: number | null; full_name?: string | null };
  if (!full_name) return null;
  return chest_no != null ? `${chest_no} ${full_name}` : full_name;
}

/**
 * Resolve the ID-card logo to a value that react-pdf can render server-side:
 *   - Remote http(s) URL (event.logo_url) is returned as-is; react-pdf will fetch it.
 *   - Otherwise the bundled default crest at /public/brand/logo.jpg is loaded
 *     from disk and returned as a base64 data URI so we don't depend on
 *     the dev server being reachable from itself.
 */
let cachedDefaultLogo: string | null = null;
async function resolveLogoSrc(logoUrl: string | null): Promise<string | null> {
  if (logoUrl && /^https?:\/\//i.test(logoUrl)) return logoUrl;
  if (cachedDefaultLogo) return cachedDefaultLogo;
  // Try a few candidate locations so we work regardless of where the Node
  // process was started (repo root vs `web/`).
  const candidates = [
    path.join(process.cwd(), "public", "brand", "logo.jpg"),
    path.join(process.cwd(), "web", "public", "brand", "logo.jpg"),
  ];
  for (const file of candidates) {
    try {
      const buf = await fs.readFile(file);
      cachedDefaultLogo = `data:image/jpeg;base64,${buf.toString("base64")}`;
      return cachedDefaultLogo;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Resolve an athlete photo to something react-pdf can render server-side.
 * We always inline as a base64 data URI so the PDF render never depends on
 * a flaky server-side fetch.
 *   - http(s) URL is fetched and inlined.
 *   - Anything else is treated as a private R2 storage key.
 *   - Failures (missing object, network error, etc.) silently return null
 *     and the card falls back to the empty placeholder box.
 */
async function resolvePhotoSrc(
  photoUrl: string | null,
): Promise<string | null> {
  if (!photoUrl) return null;
  if (/^https?:\/\//i.test(photoUrl)) {
    try {
      const res = await fetch(photoUrl);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "image/jpeg";
      return `data:${ct};base64,${buf.toString("base64")}`;
    } catch {
      return null;
    }
  }
  const obj = await getObjectBytes("private", photoUrl);
  if (!obj) return null;
  return `data:${obj.contentType};base64,${obj.bytes.toString("base64")}`;
}

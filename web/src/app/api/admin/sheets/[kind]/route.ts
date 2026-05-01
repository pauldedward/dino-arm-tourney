import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import {
  loadPaymentReport,
  loadNominal,
  loadCategory,
  loadIdCards,
  type SheetFilters,
} from "@/lib/sheets/loaders";
import { buildPaymentReportWorkbook } from "@/lib/sheets/payment-report-xlsx";
import { exportFilename } from "@/lib/export/filename";
import {
  formatCategoryCode,
  formatCategoryListForDisplay,
  parseCategoryCode,
} from "@/lib/rules/category-label";
import { WAF_ALL, wafCategory, type WafCategory } from "@/lib/rules/waf-2025";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "payment-report" | "nominal" | "category" | "id-cards";

/**
 * GET /api/admin/sheets/[kind].xlsx?event_id=<id>&q=&division=&status=
 *
 * Single styled-XLSX endpoint covering every match-day sheet that has a
 * spreadsheet equivalent. Same data shape as `/api/pdf/[kind]` so PDF
 * and XLSX never disagree.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string }> }
) {
  await requireRole("operator", "/admin");

  const { kind: rawKind } = await params;
  // Path is /api/admin/sheets/[kind] — strip a trailing .xlsx if present
  // so consumers can use either flavour of URL.
  const kind = rawKind.replace(/\.xlsx$/i, "") as Kind;
  if (!isKind(kind)) return new Response("unknown kind", { status: 400 });

  const sp = req.nextUrl.searchParams;
  const eventId = sp.get("event_id") ?? "";
  if (!eventId) return new Response("event_id required", { status: 400 });
  const filters: SheetFilters = {
    q: sp.get("q") ?? undefined,
    division: sp.get("division") ?? undefined,
    status: sp.get("status") ?? undefined,
  };

  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select("id, name, slug")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return new Response("event not found", { status: 404 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Dino Arm Tourney";
  wb.created = new Date();

  switch (kind) {
    case "payment-report":
      await buildPaymentReport(wb, svc, event.id, event.name, filters);
      break;
    case "nominal":
      await buildNominal(wb, svc, event.id, event.name, filters);
      break;
    case "category":
      await buildCategory(wb, svc, event.id, event.name);
      break;
    case "id-cards":
      await buildIdCards(wb, svc, event.id, event.name);
      break;
  }

  const buf = await wb.xlsx.writeBuffer();
  const filename = exportFilename({
    eventSlug: (event as { slug?: string | null }).slug,
    eventName: event.name,
    kind,
    ext: "xlsx",
  });
  return new Response(Buffer.from(buf), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function isKind(k: string): k is Kind {
  return (
    k === "payment-report" || k === "nominal" || k === "category" || k === "id-cards"
  );
}

/* ------------------------------------------------------------------ */
/*                       Payment report workbook                      */
/* ------------------------------------------------------------------ */

/**
 * Three-sheet workbook (Summary + Districts + Athletes) wired together
 * with formulas via `buildPaymentReportWorkbook`. Edits the operator
 * makes in the file (Total / Received / Waived) propagate through Paid
 * and Due on the Athletes sheet, then up to Districts (SUMIF) and
 * Summary (SUM) automatically.
 */
async function buildPaymentReport(
  wb: ExcelJS.Workbook,
  svc: ReturnType<typeof createServiceClient>,
  eventId: string,
  eventName: string,
  filters: SheetFilters
) {
  const { rows, totals } = await loadPaymentReport(svc, eventId, filters);
  buildPaymentReportWorkbook({ wb, eventName, rows, totals });
}

/* ------------------------------------------------------------------ */
/*                         Nominal worksheet                          */
/* ------------------------------------------------------------------ */

async function buildNominal(
  wb: ExcelJS.Workbook,
  svc: ReturnType<typeof createServiceClient>,
  eventId: string,
  eventName: string,
  filters: SheetFilters
) {
  const rows = await loadNominal(svc, eventId, filters);
  const ws = wb.addWorksheet("Nominal Roll", {
    views: [{ state: "frozen", ySplit: 3 }],
  });
  ws.columns = [
    { width: 10 }, // Chest
    { width: 28 }, // Name
    { width: 8 },  // Gender
    { width: 12 }, // DOB
    { width: 14 }, // Mobile
    { width: 18 }, // Age Category
    { width: 10 }, // Wt
    { width: 22 }, // Team / District
    { width: 22 }, // Event
    { width: 8 },  // Paid
    { width: 10 }, // Weighed
    { width: 12 }, // Status
  ];

  ws.mergeCells("A1:L1");
  const title = ws.getCell("A1");
  title.value = `${eventName} — Nominal Roll`;
  title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF1F4E78" } };
  title.alignment = { horizontal: "center" };
  ws.getRow(1).height = 26;

  const paidCount = rows.filter((r) => r.paid).length;
  const weighedCount = rows.filter((r) => r.weighed).length;
  ws.getCell("A2").value = `${rows.length} athletes · ${paidCount} paid · ${weighedCount} weighed-in`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  const headerRow = ws.getRow(3);
  [
    "Chest Number",
    "Athlete Name",
    "Gender",
    "DOB",
    "Mobile Number",
    "Age Category",
    "Weight",
    "Team / District",
    "Event Name",
    "Paid",
    "Weighed",
    "Status",
  ].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    cell.border = thinBorder("FF000000");
  });
  headerRow.height = 20;

  let rowIdx = 4;
  for (const r of rows) {
    const row = ws.getRow(rowIdx);
    row.values = [
      r.chest_no ?? "",
      r.full_name ?? "",
      r.gender ?? "",
      r.dob ?? "",
      r.mobile ?? "",
      formatCategoryListForDisplay(r.age_categories ?? []),
      r.declared_weight_kg ?? "",
      [r.team, r.district].filter(Boolean).join(" / "),
      eventName,
      r.paid ? "Yes" : "No",
      r.weighed ? "Yes" : "No",
      r.status ?? "",
    ];
    for (let c = 1; c <= 12; c++) {
      row.getCell(c).border = thinBorder("FFBFBFBF");
    }
    // Tint the boolean columns so the operator can scan the printout
    // at a glance. Green = paid/weighed, faint red = missing.
    tintBoolean(row.getCell(10), r.paid);
    tintBoolean(row.getCell(11), r.weighed);
    rowIdx++;
  }

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 12 } };
}

/* ------------------------------------------------------------------ */
/*                        Category worksheets                         */
/* ------------------------------------------------------------------ */

// 8 fixed sub-sheets: gender (M/F) × hand (R/L) × para? (no/yes).
// Within each sheet, categories are listed youngest age-band → oldest,
// then lightest weight bucket → heaviest, so the operator can scan
// the printout in the natural progression of match-day flights.
type CatBucket = {
  sheetKey: string;
  sheetName: string;
  gender: "M" | "F";
  hand: "R" | "L";
  isPara: boolean;
};

const CATEGORY_SHEET_LAYOUT: CatBucket[] = [
  { sheetKey: "M-R-able",  sheetName: "Men Right",        gender: "M", hand: "R", isPara: false },
  { sheetKey: "M-L-able",  sheetName: "Men Left",         gender: "M", hand: "L", isPara: false },
  { sheetKey: "F-R-able",  sheetName: "Women Right",      gender: "F", hand: "R", isPara: false },
  { sheetKey: "F-L-able",  sheetName: "Women Left",       gender: "F", hand: "L", isPara: false },
  { sheetKey: "M-R-para",  sheetName: "Para Men Right",   gender: "M", hand: "R", isPara: true  },
  { sheetKey: "M-L-para",  sheetName: "Para Men Left",    gender: "M", hand: "L", isPara: true  },
  { sheetKey: "F-R-para",  sheetName: "Para Women Right", gender: "F", hand: "R", isPara: true  },
  { sheetKey: "F-L-para",  sheetName: "Para Women Left",  gender: "F", hand: "L", isPara: true  },
];

type SortedCategoryEntry = {
  category_code: string;
  cat: WafCategory;
  bucketIdx: number;
  athletes: Array<{
    chest_no: number | null;
    full_name: string | null;
    district: string | null;
  }>;
};

async function buildCategory(
  wb: ExcelJS.Workbook,
  svc: ReturnType<typeof createServiceClient>,
  eventId: string,
  eventName: string
) {
  const cats = await loadCategory(svc, eventId);

  // Index loaded athletes by their canonical category code so we can
  // attach them to the pre-enumerated WAF grid below. Any code we can't
  // attach falls through to the "Other" sheet at the end.
  const athletesByCode = new Map<string, (typeof cats)[number]["athletes"]>();
  for (const c of cats) athletesByCode.set(c.category_code, c.athletes);

  // Pre-populate every sub-sheet with the full WAF grid (class × weight
  // bucket × hand) for that gender + para flag, so the operator can see
  // a header row for every category — including ones with zero eligible
  // athletes. Empty categories are an explicit signal, not noise.
  const buckets = new Map<string, SortedCategoryEntry[]>();
  for (const layout of CATEGORY_SHEET_LAYOUT) {
    const list: SortedCategoryEntry[] = [];
    const matching = WAF_ALL.filter(
      (w) => w.gender === layout.gender && w.isPara === layout.isPara,
    );
    for (const waf of matching) {
      for (let bi = 0; bi < waf.buckets.length; bi++) {
        const b = waf.buckets[bi]!;
        const code = `${waf.code}-${b.label}-${layout.hand}`;
        list.push({
          category_code: code,
          cat: waf,
          bucketIdx: bi,
          athletes: athletesByCode.get(code) ?? [],
        });
        athletesByCode.delete(code);
      }
    }
    buckets.set(layout.sheetKey, list);
  }

  // Anything still in athletesByCode didn't match a WAF cell — keep it
  // visible on a synthetic "Other" sheet so the operator notices.
  const orphans: SortedCategoryEntry[] = [];
  for (const [code, athletes] of athletesByCode) {
    const parts = parseCategoryCode(code);
    const waf = parts ? wafCategory(parts.classCode) : undefined;
    orphans.push({
      category_code: code,
      cat: waf ?? {
        code: parts?.classCode ?? code,
        className: "",
        classFull: "",
        gender: "M",
        minAge: 0,
        maxAge: null,
        isPara: false,
        posture: "Standing",
        buckets: [],
      },
      bucketIdx: 0,
      athletes,
    });
  }

  // Sort key: youngest age-band first (smallest maxAge — Junior bands
  // capped at 23 sort before open ALL bands with no cap), then by
  // minAge, then class code (deterministic across impairment classes
  // that share the same age range), finally weight bucket index
  // (lightest → heaviest as defined in waf-2025).
  const ageOrder = (e: SortedCategoryEntry): [number, number, string, number] => [
    e.cat.maxAge ?? 9999,
    e.cat.minAge,
    e.cat.code,
    e.bucketIdx,
  ];
  const cmp = (a: SortedCategoryEntry, b: SortedCategoryEntry) => {
    const ka = ageOrder(a);
    const kb = ageOrder(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i]! < kb[i]!) return -1;
      if (ka[i]! > kb[i]!) return 1;
    }
    return 0;
  };

  for (const layout of CATEGORY_SHEET_LAYOUT) {
    const entries = (buckets.get(layout.sheetKey) ?? []).slice().sort(cmp);
    writeCategorySheet(wb, layout.sheetName, eventName, entries);
  }
  if (orphans.length > 0) {
    writeCategorySheet(wb, "Other", eventName, orphans.slice().sort(cmp));
  }
}

function writeCategorySheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  eventName: string,
  entries: SortedCategoryEntry[],
) {
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 2 }],
  });
  ws.columns = [{ width: 18 }, { width: 10 }, { width: 28 }, { width: 22 }];

  ws.mergeCells("A1:D1");
  const title = ws.getCell("A1");
  title.value = `${eventName} — ${sheetName}`;
  title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF1F4E78" } };
  title.alignment = { horizontal: "center" };
  ws.getRow(1).height = 26;

  const headerRow = ws.getRow(2);
  ["Category", "Chest", "Name", "District"].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    cell.border = thinBorder("FF000000");
  });

  if (entries.length === 0) {
    ws.mergeCells("A3:D3");
    const empty = ws.getCell("A3");
    empty.value = "No athletes in this division.";
    empty.font = { italic: true, color: { argb: "FF888888" } };
    empty.alignment = { horizontal: "center" };
    return;
  }

  let rowIdx = 3;
  for (const e of entries) {
    const total = e.athletes.length;
    // Category header band — span all columns.
    ws.mergeCells(rowIdx, 1, rowIdx, 4);
    const headerCell = ws.getCell(rowIdx, 1);
    headerCell.value = `${formatCategoryCode(e.category_code)}  ·  ${e.category_code}  ·  ${total} athlete${total === 1 ? "" : "s"}`;
    headerCell.font = { bold: true };
    headerCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE7E0C8" },
    };
    rowIdx++;
    for (const a of e.athletes) {
      const row = ws.getRow(rowIdx);
      row.values = ["", a.chest_no ?? "", a.full_name ?? "", a.district ?? ""];
      for (let col = 1; col <= 4; col++) {
        row.getCell(col).border = thinBorder("FFBFBFBF");
      }
      rowIdx++;
    }
  }
}

/* ------------------------------------------------------------------ */
/*                         ID-cards worksheet                         */
/* ------------------------------------------------------------------ */

async function buildIdCards(
  wb: ExcelJS.Workbook,
  svc: ReturnType<typeof createServiceClient>,
  eventId: string,
  eventName: string
) {
  const rows = await loadIdCards(svc, eventId);
  const ws = wb.addWorksheet("ID Card Roster", {
    views: [{ state: "frozen", ySplit: 3 }],
  });
  ws.columns = [
    { width: 10 },
    { width: 28 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
  ];

  ws.mergeCells("A1:F1");
  const title = ws.getCell("A1");
  title.value = `${eventName} — ID Card Roster`;
  title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF1F4E78" } };
  title.alignment = { horizontal: "center" };
  ws.getRow(1).height = 26;

  ws.getCell("A2").value = `${rows.length} cards`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  const headerRow = ws.getRow(3);
  ["Chest", "Name", "Division", "District", "Team", "Wt (kg)"].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    cell.border = thinBorder("FF000000");
  });
  headerRow.height = 20;

  let rowIdx = 4;
  for (const r of rows) {
    const row = ws.getRow(rowIdx);
    row.values = [
      r.chest_no ?? "",
      r.full_name ?? "",
      r.division ?? "",
      r.district ?? "",
      r.team ?? "",
      r.declared_weight_kg ?? "",
    ];
    for (let c = 1; c <= 6; c++) {
      row.getCell(c).border = thinBorder("FFBFBFBF");
    }
    rowIdx++;
  }

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 6 } };
}

/* ------------------------------------------------------------------ */
/*                              helpers                               */
/* ------------------------------------------------------------------ */

function thinBorder(argb: string): Partial<ExcelJS.Borders> {
  const side = { style: "thin" as const, color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}

function tintBoolean(cell: ExcelJS.Cell, ok: boolean) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: ok ? "FFE2F0D9" : "FFFCE4D6" },
  };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.font = { bold: ok };
}

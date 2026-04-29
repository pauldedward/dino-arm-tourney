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
import { exportFilename } from "@/lib/export/filename";
import {
  formatCategoryCode,
  formatCategoryListForDisplay,
  parseCategoryCode,
} from "@/lib/rules/category-label";
import { wafCategory, type WafCategory } from "@/lib/rules/waf-2025";

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
/*                       Payment report worksheet                     */
/* ------------------------------------------------------------------ */

async function buildPaymentReport(
  wb: ExcelJS.Workbook,
  svc: ReturnType<typeof createServiceClient>,
  eventId: string,
  eventName: string,
  filters: SheetFilters
) {
  const { rows, totals } = await loadPaymentReport(svc, eventId, filters);
  const ws = wb.addWorksheet("Payment Report", {
    views: [{ state: "frozen", ySplit: 5 }],
    properties: { defaultRowHeight: 18 },
  });
  // 10 cols: Chest, Athlete, Team, Category, Total, Received, Waived,
  // Paid (received+waived), Due, Paid by.
  ws.columns = [
    { width: 14 },
    { width: 28 },
    { width: 22 },
    { width: 26 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 18 },
  ];
  const COL_COUNT = 10;

  ws.mergeCells("A1:J1");
  const title = ws.getCell("A1");
  title.value = `${eventName} — Payment Report`;
  title.font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF1F4E78" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  setPair(ws, 2, "A", "Total Athletes", totals.total_athletes);
  setPair(ws, 2, "C", "Total Billable", totals.total_billable);
  setPair(ws, 2, "E", "Total Waived", totals.total_waived);
  setPair(ws, 2, "G", "Waived athletes", totals.waived_n);
  setPair(ws, 2, "I", "Effective Total", totals.total_effective);
  setPair(ws, 3, "A", "Total Received", totals.total_received);
  setPair(ws, 3, "C", "Total Due", totals.total_due);
  setPair(ws, 3, "E", "% Collected", `${round2(totals.percent_paid)}%`);
  setPair(
    ws,
    3,
    "G",
    "Avg Received",
    totals.total_athletes ? round2(totals.total_received / totals.total_athletes) : 0
  );
  setPair(
    ws,
    3,
    "I",
    "Avg Due",
    totals.total_athletes ? round2(totals.total_due / totals.total_athletes) : 0
  );
  styleSummaryRow(ws.getRow(2), { italic: false }, COL_COUNT);
  styleSummaryRow(ws.getRow(3), { italic: true }, COL_COUNT);

  for (let c = 1; c <= COL_COUNT; c++) {
    ws.getCell(4, c).border = {
      top: { style: "dashed", color: { argb: "FF92D050" } },
    };
  }
  ws.getRow(4).height = 6;

  const headerRow = ws.getRow(5);
  [
    "Chest Number",
    "Athlete",
    "Team / District",
    "Category",
    "Total ₹",
    "Received ₹",
    "Waived ₹",
    "Paid ₹",
    "Due ₹",
    "Paid by",
  ].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4B0082" },
    };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = thinBorder("FF000000");
  });
  headerRow.height = 22;

  let rowIdx = 6;
  for (const r of rows) {
    const row = ws.getRow(rowIdx);
    row.values = [
      r.chest_no ?? "",
      r.full_name ?? "",
      r.team_or_district ?? "",
      r.category,
      r.total_inr,
      r.received_inr,
      r.waived_inr,
      r.paid_inr,
      r.due_inr,
      r.paid_by ?? "",
    ];
    for (let c = 1; c <= COL_COUNT; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder("FFBFBFBF");
      cell.alignment = { vertical: "middle" };
      if (c >= 5 && c <= 9) cell.numFmt = "#,##0";
    }
    rowIdx++;
  }

  const totalRow = ws.getRow(rowIdx);
  totalRow.getCell(4).value = "GRAND TOTAL";
  totalRow.getCell(5).value = totals.total_billable;
  totalRow.getCell(6).value = totals.total_received;
  totalRow.getCell(7).value = totals.total_waived;
  totalRow.getCell(8).value = totals.total_paid;
  totalRow.getCell(9).value = totals.total_due;
  for (let c = 1; c <= COL_COUNT; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true };
    cell.border = thinBorder("FF000000");
    if (c >= 5 && c <= 9) cell.numFmt = "#,##0";
  }
  totalRow.getCell(4).alignment = { horizontal: "right" };

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: COL_COUNT } };
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

  // Bucket every category into one of the 8 sub-sheets, falling back to
  // a synthetic "Other" sheet only if a code cannot be parsed (defensive
  // — should not happen for properly-coded entries).
  const buckets = new Map<string, SortedCategoryEntry[]>();
  for (const layout of CATEGORY_SHEET_LAYOUT) buckets.set(layout.sheetKey, []);
  const orphans: SortedCategoryEntry[] = [];

  for (const c of cats) {
    if (c.athletes.length === 0) continue;
    const parts = parseCategoryCode(c.category_code);
    const waf = parts ? wafCategory(parts.classCode) : undefined;
    if (!parts || !waf) {
      orphans.push({
        category_code: c.category_code,
        cat: {
          code: parts?.classCode ?? c.category_code,
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
        athletes: c.athletes,
      });
      continue;
    }
    const bucketIdx = waf.buckets.findIndex(
      (b) => b.code === c.category_code.slice(0, c.category_code.lastIndexOf("-"))
        || b.label === parts.weight,
    );
    const key = `${waf.gender}-${parts.hand}-${waf.isPara ? "para" : "able"}`;
    const target = buckets.get(key);
    if (!target) {
      orphans.push({ category_code: c.category_code, cat: waf, bucketIdx, athletes: c.athletes });
      continue;
    }
    target.push({
      category_code: c.category_code,
      cat: waf,
      bucketIdx: bucketIdx >= 0 ? bucketIdx : 999,
      athletes: c.athletes,
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

function setPair(
  ws: ExcelJS.Worksheet,
  row: number,
  labelCol: string,
  label: string,
  value: string | number
) {
  const labelCell = ws.getCell(`${labelCol}${row}`);
  labelCell.value = label;
  labelCell.font = { bold: true };
  const valCol = String.fromCharCode(labelCol.charCodeAt(0) + 1);
  ws.getCell(`${valCol}${row}`).value = value;
}

function styleSummaryRow(
  row: ExcelJS.Row,
  opts: { italic: boolean },
  colCount = 6,
) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    if (opts.italic) {
      const f = cell.font ?? {};
      cell.font = { ...f, italic: true };
    }
    cell.alignment = { vertical: "middle", horizontal: "left" };
  }
  row.height = 20;
}

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

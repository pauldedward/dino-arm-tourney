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
  ws.columns = [
    { width: 14 },
    { width: 28 },
    { width: 22 },
    { width: 26 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 18 },
  ];

  ws.mergeCells("A1:H1");
  const title = ws.getCell("A1");
  title.value = `${eventName} — Payment Report`;
  title.font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF1F4E78" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  setPair(ws, 2, "A", "Total Athletes", totals.total_athletes);
  setPair(ws, 2, "C", "Total Paid", totals.total_paid);
  setPair(ws, 2, "E", "Total Due", totals.total_due);
  setPair(ws, 3, "A", "% Paid", `${round2(totals.percent_paid)}%`);
  setPair(
    ws,
    3,
    "C",
    "Avg Paid",
    totals.total_athletes ? round2(totals.total_paid / totals.total_athletes) : 0
  );
  setPair(
    ws,
    3,
    "E",
    "Avg Due",
    totals.total_athletes ? round2(totals.total_due / totals.total_athletes) : 0
  );
  styleSummaryRow(ws.getRow(2), { italic: false });
  styleSummaryRow(ws.getRow(3), { italic: true });

  for (let c = 1; c <= 8; c++) {
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
      r.paid_inr,
      r.due_inr,
      r.paid_by ?? "",
    ];
    for (let c = 1; c <= 8; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder("FFBFBFBF");
      cell.alignment = { vertical: "middle" };
      if (c >= 5 && c <= 7) cell.numFmt = "#,##0";
    }
    rowIdx++;
  }

  const totalRow = ws.getRow(rowIdx);
  totalRow.getCell(4).value = "GRAND TOTAL";
  totalRow.getCell(6).value = totals.total_paid;
  totalRow.getCell(7).value = totals.total_due;
  for (let c = 1; c <= 8; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true };
    cell.border = thinBorder("FF000000");
    if (c >= 5 && c <= 7) cell.numFmt = "#,##0";
  }
  totalRow.getCell(4).alignment = { horizontal: "right" };

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 8 } };
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
    { width: 10 },
    { width: 28 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 8 },
    { width: 10 },
    { width: 14 },
  ];

  ws.mergeCells("A1:I1");
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
    "Chest",
    "Name",
    "Division",
    "District",
    "Team",
    "Wt (kg)",
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
      r.division ?? "",
      r.district ?? "",
      r.team ?? "",
      r.declared_weight_kg ?? "",
      r.paid ? "Yes" : "No",
      r.weighed ? "Yes" : "No",
      r.status ?? "",
    ];
    for (let c = 1; c <= 9; c++) {
      row.getCell(c).border = thinBorder("FFBFBFBF");
    }
    // Tint the boolean columns so the operator can scan the printout
    // at a glance. Green = paid/weighed, faint red = missing.
    tintBoolean(row.getCell(7), r.paid);
    tintBoolean(row.getCell(8), r.weighed);
    rowIdx++;
  }

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 9 } };
}

/* ------------------------------------------------------------------ */
/*                        Category worksheet                          */
/* ------------------------------------------------------------------ */

async function buildCategory(
  wb: ExcelJS.Workbook,
  svc: ReturnType<typeof createServiceClient>,
  eventId: string,
  eventName: string
) {
  const cats = await loadCategory(svc, eventId);
  const ws = wb.addWorksheet("Category Sheet", {
    views: [{ state: "frozen", ySplit: 2 }],
  });
  ws.columns = [{ width: 18 }, { width: 10 }, { width: 28 }, { width: 22 }];

  ws.mergeCells("A1:D1");
  const title = ws.getCell("A1");
  title.value = `${eventName} — Category Sheet`;
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

  let rowIdx = 3;
  for (const c of cats) {
    const total = c.athletes.length;
    if (total === 0) continue;
    // Category header band — span all columns.
    ws.mergeCells(rowIdx, 1, rowIdx, 4);
    const headerCell = ws.getCell(rowIdx, 1);
    headerCell.value = `${c.category_code}  ·  ${total} athlete${total === 1 ? "" : "s"}`;
    headerCell.font = { bold: true };
    headerCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE7E0C8" },
    };
    rowIdx++;
    for (const a of c.athletes) {
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

function styleSummaryRow(row: ExcelJS.Row, opts: { italic: boolean }) {
  for (let c = 1; c <= 6; c++) {
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

/**
 * Multi-sheet "Payment Report" workbook builder.
 *
 * Three worksheets, all wired together with formulas so the workbook
 * stays self-consistent when an operator edits cells in Excel /
 * LibreOffice / Google Sheets:
 *
 *   1. Summary    — overall totals (SUM formulas over the Athletes
 *                   sheet so any edit there ripples up).
 *   2. Districts  — one row per team / district, all values via
 *                   SUMIF / COUNTIF formulas over the Athletes sheet.
 *   3. Athletes   — per-athlete rows. The operator types Total /
 *                   Received / Waived; Paid (Recv+Waived) and Due
 *                   (Total−Paid) are formula columns.
 *
 * `wb.calcProperties.fullCalcOnLoad = true` guarantees every reader
 * recomputes on open instead of trusting cached results.
 *
 * Both `/api/admin/sheets/payment-report` (canonical) and the legacy
 * `/api/admin/payments.xlsx` alias delegate here so the two endpoints
 * cannot drift.
 */
import ExcelJS from "exceljs";
import type {
  PaymentReportRow,
  PaymentReportTotals,
} from "@/lib/pdf/PaymentReportSheet";
import {
  rollupByDistrict,
  type DistrictRollup,
} from "@/lib/payments/district-rollup";

const HDR_FILL_INK = "FF1F4E78";
const HDR_FILL_PURPLE = "FF4B0082";
const HDR_FILL_KRAFT = "FFE7E0C8";
const TOTAL_FILL = "FFF3F3F3";

/** Where the Athletes table header lives (row 3, columns A..K). */
const ATH_HDR_ROW = 3;
const ATH_FIRST_DATA_ROW = 4;
/** Athletes column letters — kept in one place so cross-sheet formulas
 *  stay in sync if a column ever moves. */
const ATH = {
  CHEST: "A",
  NAME: "B",
  DISTRICT: "C",
  CATEGORY: "D",
  WEIGHT: "E",
  TOTAL: "F",
  RECEIVED: "G",
  WAIVED: "H",
  PAID: "I",
  DUE: "J",
  PAID_BY: "K",
} as const;
const ATH_COL_COUNT = 11;

const DIST_HDR_ROW = 3;
const DIST_FIRST_DATA_ROW = 4;
const DIST_COL_COUNT = 8;

export function buildPaymentReportWorkbook(opts: {
  wb: ExcelJS.Workbook;
  eventName: string;
  rows: PaymentReportRow[];
  totals: PaymentReportTotals;
}): void {
  const { wb, eventName, rows, totals } = opts;
  // Force a recalculation when any reader opens the file. Without this
  // some clients (older Excel, headless converters) display the cached
  // numeric `result` we wrote and never re-evaluate when the user edits
  // an input cell.
  wb.calcProperties.fullCalcOnLoad = true;

  const districts = rollupByDistrict(rows);

  // Add in display order: Summary first so it's the active tab on open.
  buildSummarySheet(wb, eventName, totals, rows.length, districts.length);
  buildDistrictsSheet(wb, eventName, districts, rows.length);
  buildAthletesSheet(wb, eventName, rows);

  // Make the Summary tab the active one. ExcelJS uses 0-based tab idx.
  wb.views = [
    {
      x: 0,
      y: 0,
      width: 10000,
      height: 20000,
      firstSheet: 0,
      activeTab: 0,
      visibility: "visible",
    },
  ];
}

/* ------------------------------------------------------------------ */
/*                           Summary worksheet                        */
/* ------------------------------------------------------------------ */

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  eventName: string,
  totals: PaymentReportTotals,
  athleteCount: number,
  districtCount: number,
): void {
  const ws = wb.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 2 }],
  });
  ws.columns = [
    { width: 28 },
    { width: 18 },
    { width: 4 },
    { width: 28 },
    { width: 18 },
  ];

  ws.mergeCells("A1:E1");
  const title = ws.getCell("A1");
  title.value = `${eventName} — Payment Report`;
  title.font = {
    name: "Calibri",
    size: 18,
    bold: true,
    color: { argb: HDR_FILL_INK },
  };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.mergeCells("A2:E2");
  const sub = ws.getCell("A2");
  sub.value = `${districtCount} districts · ${athleteCount} athletes · edits to Athletes / Districts roll up here automatically`;
  sub.font = { italic: true, color: { argb: "FF666666" } };
  sub.alignment = { horizontal: "center" };
  ws.getRow(2).height = 18;

  // Athletes sheet ranges referenced by SUM formulas. The column-wide
  // `Athletes!E:E` style would also work but pinning the range to the
  // known data rows keeps the formula readable in the cell editor.
  const lastAthRow = ATH_FIRST_DATA_ROW + Math.max(0, athleteCount) - 1;
  const athRange = (col: string) =>
    athleteCount > 0
      ? `Athletes!${col}${ATH_FIRST_DATA_ROW}:${col}${lastAthRow}`
      : null;

  type Pair = {
    label: string;
    formula: string | null;
    fallback: number | string;
    numFmt?: string;
    note?: string;
  };
  const pairs: Pair[] = [
    {
      label: "Total Athletes",
      formula: athRange(ATH.NAME)
        ? `COUNTA(${athRange(ATH.NAME)})`
        : null,
      fallback: totals.total_athletes,
      numFmt: "#,##0",
    },
    {
      label: "Total Billable (₹)",
      formula: athRange(ATH.TOTAL)
        ? `SUM(${athRange(ATH.TOTAL)})`
        : null,
      fallback: totals.total_billable,
      numFmt: "#,##0",
    },
    {
      label: "Total Received (₹)",
      formula: athRange(ATH.RECEIVED)
        ? `SUM(${athRange(ATH.RECEIVED)})`
        : null,
      fallback: totals.total_received,
      numFmt: "#,##0",
    },
    {
      label: "Total Waived (₹)",
      formula: athRange(ATH.WAIVED)
        ? `SUM(${athRange(ATH.WAIVED)})`
        : null,
      fallback: totals.total_waived,
      numFmt: "#,##0",
    },
    {
      label: "Effective (Billable − Waived)",
      formula: "B4-B6",
      fallback: totals.total_effective,
      numFmt: "#,##0",
    },
    {
      label: "Total Due (₹)",
      formula: athRange(ATH.DUE) ? `SUM(${athRange(ATH.DUE)})` : null,
      fallback: totals.total_due,
      numFmt: "#,##0",
      note: "Outstanding on still-pending payments. = Total − Received − Waived per athlete (clamped at 0).",
    },
    {
      label: "% Collected",
      formula: "IF(B7>0, MIN(1, B5/B7), 1)",
      fallback: totals.percent_paid / 100,
      numFmt: "0.0%",
      note: "Received ÷ Effective. Waivers don't dilute the rate.",
    },
  ];

  // Lay out as label/value pairs starting at row 3.
  let r = 3;
  for (const p of pairs) {
    const lc = ws.getCell(`A${r}`);
    lc.value = p.label;
    lc.font = { bold: true };
    lc.alignment = { vertical: "middle" };
    const vc = ws.getCell(`B${r}`);
    if (p.formula) {
      vc.value = {
        formula: p.formula,
        result: p.fallback as number,
        date1904: false,
      };
    } else {
      vc.value = p.fallback;
    }
    if (p.numFmt) vc.numFmt = p.numFmt;
    vc.alignment = { horizontal: "right", vertical: "middle" };
    if (p.note) {
      const nc = ws.getCell(`D${r}`);
      nc.value = p.note;
      nc.font = { italic: true, color: { argb: "FF666666" }, size: 10 };
      ws.mergeCells(`D${r}:E${r}`);
    }
    r++;
  }

  // Tip box.
  const tipRow = r + 1;
  ws.mergeCells(`A${tipRow}:E${tipRow}`);
  const tip = ws.getCell(`A${tipRow}`);
  tip.value =
    "Tip: edit Total / Received / Waived on the Athletes sheet — Paid & Due (and every total here & on Districts) recompute automatically.";
  tip.font = { italic: true, color: { argb: "FF1F4E78" } };
  tip.alignment = { wrapText: true };
  ws.getRow(tipRow).height = 28;
}

/* ------------------------------------------------------------------ */
/*                          Districts worksheet                       */
/* ------------------------------------------------------------------ */

function buildDistrictsSheet(
  wb: ExcelJS.Workbook,
  eventName: string,
  districts: DistrictRollup[],
  athleteCount: number,
): void {
  const ws = wb.addWorksheet("Districts", {
    views: [{ state: "frozen", ySplit: DIST_HDR_ROW }],
  });
  ws.columns = [
    { width: 28 }, // District
    { width: 12 }, // Athletes
    { width: 14 }, // Total ₹
    { width: 14 }, // Received ₹
    { width: 14 }, // Waived ₹
    { width: 14 }, // Effective ₹
    { width: 14 }, // Due ₹
    { width: 12 }, // % Collected
  ];

  ws.mergeCells(`A1:H1`);
  const title = ws.getCell("A1");
  title.value = `${eventName} — Collection by district`;
  title.font = {
    name: "Calibri",
    size: 16,
    bold: true,
    color: { argb: HDR_FILL_INK },
  };
  title.alignment = { horizontal: "center" };
  ws.getRow(1).height = 26;

  ws.mergeCells(`A2:H2`);
  const sub = ws.getCell("A2");
  sub.value =
    "Counts and rupee totals are SUMIF / COUNTIF formulas over the Athletes sheet — edit there to see numbers update here.";
  sub.font = { italic: true, color: { argb: "FF666666" } };
  sub.alignment = { horizontal: "center" };

  const headerRow = ws.getRow(DIST_HDR_ROW);
  [
    "District / Team",
    "Athletes",
    "Total ₹",
    "Received ₹",
    "Waived ₹",
    "Effective ₹",
    "Due ₹",
    "% Collected",
  ].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HDR_FILL_INK },
    };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = thinBorder("FF000000");
  });
  headerRow.height = 22;

  const lastAthRow = ATH_FIRST_DATA_ROW + Math.max(0, athleteCount) - 1;
  // Use absolute refs so the row formulas stay readable / consistent
  // when the operator copy-pastes a row.
  const distCol = `Athletes!$${ATH.DISTRICT}$${ATH_FIRST_DATA_ROW}:$${ATH.DISTRICT}$${lastAthRow}`;
  const sumifRange = (col: string) =>
    `Athletes!$${col}$${ATH_FIRST_DATA_ROW}:$${col}$${lastAthRow}`;

  let rowIdx = DIST_FIRST_DATA_ROW;
  for (const d of districts) {
    const row = ws.getRow(rowIdx);
    const keyRef = `A${rowIdx}`;
    row.getCell(1).value = d.district;
    if (athleteCount > 0) {
      row.getCell(2).value = {
        formula: `COUNTIF(${distCol},${keyRef})`,
        result: d.athletes_n,
        date1904: false,
      };
      row.getCell(3).value = {
        formula: `SUMIF(${distCol},${keyRef},${sumifRange(ATH.TOTAL)})`,
        result: d.total_billable,
        date1904: false,
      };
      row.getCell(4).value = {
        formula: `SUMIF(${distCol},${keyRef},${sumifRange(ATH.RECEIVED)})`,
        result: d.total_received,
        date1904: false,
      };
      row.getCell(5).value = {
        formula: `SUMIF(${distCol},${keyRef},${sumifRange(ATH.WAIVED)})`,
        result: d.total_waived,
        date1904: false,
      };
      row.getCell(6).value = {
        formula: `MAX(0, C${rowIdx}-E${rowIdx})`,
        result: d.total_effective,
        date1904: false,
      };
      row.getCell(7).value = {
        formula: `SUMIF(${distCol},${keyRef},${sumifRange(ATH.DUE)})`,
        result: d.total_due,
        date1904: false,
      };
      row.getCell(8).value = {
        formula: `IF(F${rowIdx}>0, MIN(1, D${rowIdx}/F${rowIdx}), 1)`,
        result: d.percent_collected / 100,
        date1904: false,
      };
    } else {
      // Defensive: empty workbook still gets readable numbers.
      row.getCell(2).value = d.athletes_n;
      row.getCell(3).value = d.total_billable;
      row.getCell(4).value = d.total_received;
      row.getCell(5).value = d.total_waived;
      row.getCell(6).value = d.total_effective;
      row.getCell(7).value = d.total_due;
      row.getCell(8).value = d.percent_collected / 100;
    }
    for (let c = 1; c <= DIST_COL_COUNT; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder("FFBFBFBF");
      cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "right" };
      if (c >= 2 && c <= 7) cell.numFmt = "#,##0";
      if (c === 8) cell.numFmt = "0.0%";
    }
    rowIdx++;
  }

  // GRAND TOTAL row — SUM across the visible district rows so it
  // reflects whatever the SUMIFs return.
  if (districts.length > 0) {
    const totalRow = ws.getRow(rowIdx);
    const firstD = DIST_FIRST_DATA_ROW;
    const lastD = rowIdx - 1;
    totalRow.getCell(1).value = "GRAND TOTAL";
    totalRow.getCell(2).value = {
      formula: `SUM(B${firstD}:B${lastD})`,
      result: districts.reduce((s, d) => s + d.athletes_n, 0),
      date1904: false,
    };
    // Pre-compute the aggregate fallbacks so readers that don't honor
    // `fullCalcOnLoad` (browsers, several PDF/preview tools, Google
    // Sheets import) don't show 0 for everything and a misleading
    // 100% for "% Collected".
    const sumBillable = districts.reduce((s, d) => s + d.total_billable, 0);
    const sumReceived = districts.reduce((s, d) => s + d.total_received, 0);
    const sumWaived = districts.reduce((s, d) => s + d.total_waived, 0);
    const sumDue = districts.reduce((s, d) => s + d.total_due, 0);
    // Grand Effective uses the GLOBAL formula (SUM Billable − SUM
    // Waived, clamped) so it matches Summary!B7. Summing the
    // per-district MAX(0, C-E) values can drift if any district has
    // waived > billable.
    const sumEffectiveGlobal = Math.max(0, sumBillable - sumWaived);
    const grandFallbacks: Record<number, number> = {
      3: sumBillable,
      4: sumReceived,
      5: sumWaived,
      6: sumEffectiveGlobal,
      7: sumDue,
    };
    for (const [colIdx, col] of [
      [3, "C"],
      [4, "D"],
      [5, "E"],
      [7, "G"],
    ] as [number, string][]) {
      totalRow.getCell(colIdx).value = {
        formula: `SUM(${col}${firstD}:${col}${lastD})`,
        result: grandFallbacks[colIdx],
        date1904: false,
      };
    }
    // Grand Effective: explicit MAX(0, grandTotal − grandWaived) so it
    // mirrors the Summary sheet's derivation exactly.
    totalRow.getCell(6).value = {
      formula: `MAX(0, C${rowIdx}-E${rowIdx})`,
      result: sumEffectiveGlobal,
      date1904: false,
    };
    // Compute % Collected the same way the Summary sheet does — straight
    // from the Athletes ranges (unclamped SUM(Billable) − SUM(Waived))
    // — instead of dividing the grand row's own D/F. The per-district
    // Effective in column F is clamped at 0, and summing clamped values
    // can drift from the Summary's global subtraction. Reading from the
    // same source guarantees the two sheets show the exact same number.
    const totalRange = sumifRange(ATH.TOTAL);
    const recvRange = sumifRange(ATH.RECEIVED);
    const waivRange = sumifRange(ATH.WAIVED);
    const grandPct =
      sumEffectiveGlobal > 0
        ? Math.min(1, sumReceived / sumEffectiveGlobal)
        : 1;
    const grandPctFormula =
      athleteCount > 0
        ? `IF(SUM(${totalRange})-SUM(${waivRange})>0, MIN(1, SUM(${recvRange})/(SUM(${totalRange})-SUM(${waivRange}))), 1)`
        : null;
    totalRow.getCell(8).value = grandPctFormula
      ? {
          formula: grandPctFormula,
          result: grandPct,
          date1904: false,
        }
      : grandPct;
    for (let c = 1; c <= DIST_COL_COUNT; c++) {
      const cell = totalRow.getCell(c);
      cell.font = { bold: true };
      cell.border = thinBorder("FF000000");
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: TOTAL_FILL },
      };
      cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "right" };
      if (c >= 2 && c <= 7) cell.numFmt = "#,##0";
      if (c === 8) cell.numFmt = "0.0%";
    }
  }

  ws.autoFilter = {
    from: { row: DIST_HDR_ROW, column: 1 },
    to: { row: DIST_HDR_ROW, column: DIST_COL_COUNT },
  };
}

/* ------------------------------------------------------------------ */
/*                          Athletes worksheet                        */
/* ------------------------------------------------------------------ */

function buildAthletesSheet(
  wb: ExcelJS.Workbook,
  eventName: string,
  rows: PaymentReportRow[],
): void {
  const ws = wb.addWorksheet("Athletes", {
    views: [{ state: "frozen", ySplit: ATH_HDR_ROW }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = [
    { width: 14 }, // Chest
    { width: 28 }, // Athlete
    { width: 22 }, // District / team
    { width: 22 }, // Age Category
    { width: 26 }, // Weight Class
    { width: 12 }, // Total
    { width: 12 }, // Received
    { width: 12 }, // Waived
    { width: 12 }, // Paid (formula)
    { width: 12 }, // Due (formula)
    { width: 18 }, // Paid by
  ];

  ws.mergeCells(`A1:K1`);
  const title = ws.getCell("A1");
  title.value = `${eventName} — Athletes`;
  title.font = {
    name: "Calibri",
    size: 16,
    bold: true,
    color: { argb: HDR_FILL_INK },
  };
  title.alignment = { horizontal: "center" };
  ws.getRow(1).height = 26;

  ws.mergeCells(`A2:K2`);
  const sub = ws.getCell("A2");
  sub.value =
    "Edit Total / Received / Waived in any row — Paid (=Recv+Waiv) and Due (=Total−Paid) recompute automatically; Districts and Summary roll up.";
  sub.font = { italic: true, color: { argb: "FF666666" } };
  sub.alignment = { horizontal: "center" };

  const headerRow = ws.getRow(ATH_HDR_ROW);
  [
    "Chest Number",
    "Athlete",
    "District / Team",
    "Age Category",
    "Weight Class",
    "Total ₹",
    "Received ₹",
    "Waived ₹",
    "Paid ₹  (=G+H)",
    "Due ₹  (=F−I)",
    "Paid by",
  ].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HDR_FILL_PURPLE },
    };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = thinBorder("FF000000");
  });
  headerRow.height = 22;

  let rowIdx = ATH_FIRST_DATA_ROW;
  for (const r of rows) {
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = r.chest_no ?? "";
    row.getCell(2).value = r.full_name ?? "";
    row.getCell(3).value = r.team_or_district ?? "";
    row.getCell(4).value = r.age_categories;
    row.getCell(5).value = r.weight_classes.join(", ");
    row.getCell(6).value = r.total_inr;
    row.getCell(7).value = r.received_inr;
    row.getCell(8).value = r.waived_inr;
    // Paid = Received + Waived. Formula so a manual edit to G or H
    // immediately updates Paid (and via I, Due).
    row.getCell(9).value = {
      formula: `${ATH.RECEIVED}${rowIdx}+${ATH.WAIVED}${rowIdx}`,
      result: r.paid_inr,
      date1904: false,
    };
    // Due = max(0, Total − Paid). Same as the SQL view's clamp.
    row.getCell(10).value = {
      formula: `MAX(0, ${ATH.TOTAL}${rowIdx}-${ATH.PAID}${rowIdx})`,
      result: r.due_inr,
      date1904: false,
    };
    row.getCell(11).value = r.paid_by ?? "";
    for (let c = 1; c <= ATH_COL_COUNT; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder("FFBFBFBF");
      cell.alignment = { vertical: "middle" };
      if (c >= 6 && c <= 10) cell.numFmt = "#,##0";
    }
    // Faint highlight on the formula columns so the operator knows
    // those cells will recompute (and discourages manual overwrite).
    tintFormula(row.getCell(9));
    tintFormula(row.getCell(10));
    rowIdx++;
  }

  // GRAND TOTAL row.
  if (rows.length > 0) {
    const totalRow = ws.getRow(rowIdx);
    totalRow.getCell(5).value = "GRAND TOTAL";
    const firstD = ATH_FIRST_DATA_ROW;
    const lastD = rowIdx - 1;
    for (const [colIdx, col] of [
      [6, ATH.TOTAL],
      [7, ATH.RECEIVED],
      [8, ATH.WAIVED],
      [9, ATH.PAID],
      [10, ATH.DUE],
    ] as [number, string][]) {
      totalRow.getCell(colIdx).value = {
        formula: `SUM(${col}${firstD}:${col}${lastD})`,
        result: 0,
        date1904: false,
      };
    }
    for (let c = 1; c <= ATH_COL_COUNT; c++) {
      const cell = totalRow.getCell(c);
      cell.font = { bold: true };
      cell.border = thinBorder("FF000000");
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: TOTAL_FILL },
      };
      if (c >= 6 && c <= 10) cell.numFmt = "#,##0";
    }
    totalRow.getCell(5).alignment = { horizontal: "right" };
  }

  ws.autoFilter = {
    from: { row: ATH_HDR_ROW, column: 1 },
    to: { row: ATH_HDR_ROW, column: ATH_COL_COUNT },
  };
}

/* ------------------------------------------------------------------ */
/*                              helpers                               */
/* ------------------------------------------------------------------ */

function thinBorder(argb: string): Partial<ExcelJS.Borders> {
  const side = { style: "thin" as const, color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}

function tintFormula(cell: ExcelJS.Cell): void {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF2F2F2" },
  };
  cell.font = { italic: true };
}

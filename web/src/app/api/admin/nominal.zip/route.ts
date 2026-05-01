import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { loadNominal } from "@/lib/sheets/loaders";
import type { NominalRow } from "@/lib/pdf/NominalSheet";
import { recordAudit } from "@/lib/audit";
import { exportFilename } from "@/lib/export/filename";
import { formatCategoryListForDisplay } from "@/lib/rules/category-label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/nominal.zip?event_id=…&q=…&division=…
 *
 * Bundles the nominal roll into a single ZIP containing:
 *   districts/<District>.xlsx  — one workbook per district
 *   teams/<Team>.xlsx          — one workbook per team
 * Each file holds only the athletes for that district/team.
 */
export async function GET(req: NextRequest) {
  const session = await requireRole("operator", "/admin");

  const sp = req.nextUrl.searchParams;
  const eventId = sp.get("event_id") ?? "";
  if (!eventId) return new Response("event_id required", { status: 400 });
  const q = sp.get("q") ?? undefined;
  const division = sp.get("division") ?? undefined;

  const svc = createServiceClient();
  const { data: event } = await svc
    .from("events")
    .select("id, name, slug")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return new Response("event not found", { status: 404 });

  const rows = await loadNominal(svc, eventId, { q, division });

  const zip = new JSZip();
  const districts = zip.folder("districts")!;
  const teams = zip.folder("teams")!;

  const byDistrict = groupBy(rows, (r) => r.district);
  const byTeam = groupBy(rows, (r) => r.team);

  for (const [name, group] of byDistrict) {
    const buf = await buildSheet(event.name, "District", name, group);
    districts.file(`${safeFilename(name)}.xlsx`, buf);
  }
  for (const [name, group] of byTeam) {
    const buf = await buildSheet(event.name, "Team", name, group);
    teams.file(`${safeFilename(name)}.xlsx`, buf);
  }

  const zipBuf = await zip.generateAsync({ type: "uint8array" });

  await recordAudit({
    eventId,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "xlsx.nominal.zip",
    payload: {
      event_id: eventId,
      districts: byDistrict.size,
      teams: byTeam.size,
      rows: rows.length,
    },
  });

  const filename = exportFilename({
    eventSlug: (event as { slug?: string | null }).slug,
    eventName: event.name,
    kind: "nominal",
    ext: "zip",
  });
  return new Response(new Blob([zipBuf as BlobPart], { type: "application/zip" }), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function groupBy(
  rows: NominalRow[],
  key: (r: NominalRow) => string | null | undefined
): Map<string, NominalRow[]> {
  const out = new Map<string, NominalRow[]>();
  for (const r of rows) {
    const raw = (key(r) ?? "").trim();
    if (!raw) continue;
    const arr = out.get(raw) ?? [];
    arr.push(r);
    out.set(raw, arr);
  }
  return new Map(Array.from(out).sort(([a], [b]) => a.localeCompare(b)));
}

async function buildSheet(
  eventName: string,
  groupLabel: "District" | "Team",
  groupName: string,
  rows: NominalRow[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dino Arm Tourney";
  wb.created = new Date();
  const ws = wb.addWorksheet("Nominal Roll", {
    views: [{ state: "frozen", ySplit: 4 }],
    properties: { defaultRowHeight: 18 },
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
    { width: 24 }, // Event
  ];

  ws.mergeCells("A1:I1");
  const title = ws.getCell("A1");
  title.value = `${eventName} — Nominal Roll`;
  title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF1F4E78" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:I2");
  const sub = ws.getCell("A2");
  sub.value = `${groupLabel}: ${groupName}  ·  ${rows.length} athletes  ·  generated ${new Date().toLocaleString("en-IN")}`;
  sub.font = { italic: true, color: { argb: "FF555555" } };
  sub.alignment = { horizontal: "center" };

  const headers = [
    "Chest Number",
    "Athlete Name",
    "Gender",
    "DOB",
    "Mobile Number",
    "Age Category",
    "Weight",
    "Team / District",
    "Event Name",
  ];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4B0082" },
    };
    c.alignment = { vertical: "middle" };
    c.border = thinBorder("FF000000");
  });
  headerRow.height = 22;

  const sorted = [...rows].sort((a, b) =>
    (a.full_name ?? "").localeCompare(b.full_name ?? "")
  );
  let idx = 5;
  for (const r of sorted) {
    const row = ws.getRow(idx++);
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
    ];
    for (let c = 1; c <= 9; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder("FFBFBFBF");
      cell.alignment = { vertical: "middle" };
    }
    row.getCell(7).numFmt = "0.0";
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 9 } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function thinBorder(argb: string): Partial<ExcelJS.Borders> {
  const side = { style: "thin" as const, color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}

function safeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "unnamed"
  );
}

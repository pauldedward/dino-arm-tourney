import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isOperator } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = [
  "chest_no","full_name","initial","dob","gender","division","is_para","para_class","para_posture",
  "affiliation_kind","district","team","mobile","aadhaar_masked","declared_weight_kg",
  "age_categories","youth_hand","senior_hand","status","created_at",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return `"${v.join(";")}"`;
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const sess = await getSession();
  if (!isOperator(sess.role)) return new NextResponse("Forbidden", { status: 403 });
  const eventId = req.nextUrl.searchParams.get("event_id");
  const admin = createAdminClient();
  let q = admin.from("registrations").select(COLS.join(",")).order("chest_no");
  if (eventId) q = q.eq("event_id", eventId);
  const { data, error } = await q;
  if (error) return new NextResponse(error.message, { status: 500 });

  const lines = [COLS.join(",")];
  for (const row of (data as unknown as Record<string, unknown>[]) ?? []) {
    lines.push(COLS.map((c) => csvEscape(row[c])).join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="registrations-${eventId ?? "all"}.csv"`,
    },
  });
}

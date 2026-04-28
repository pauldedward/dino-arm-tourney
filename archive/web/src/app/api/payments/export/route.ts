import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isOperator } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = ["amount_inr","status","method","provider","utr","verified_at","verified_by","registration_id","created_at"];

function csv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const sess = await getSession();
  if (!isOperator(sess.role)) return new NextResponse("Forbidden", { status: 403 });
  const admin = createAdminClient();
  const eventId = req.nextUrl.searchParams.get("event_id");
  let q = admin.from("payments").select(`${COLS.join(",")},registrations!inner(event_id)`).order("created_at", { ascending: false }).limit(50000);
  if (eventId) q = q.eq("registrations.event_id", eventId);
  const { data, error } = await q;
  if (error) return new NextResponse(error.message, { status: 500 });
  const lines = [COLS.join(",")];
  for (const row of (data as unknown as Record<string, unknown>[]) ?? []) {
    lines.push(COLS.map((c) => csv(row[c])).join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payments-${eventId ?? "all"}.csv"`,
    },
  });
}

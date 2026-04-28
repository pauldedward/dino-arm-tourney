import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = ["created_at","action","actor_label","target_table","target_id","event_id","client_ip","payload"];

function csv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: NextRequest) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) return new NextResponse("Forbidden", { status: 403 });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("audit_log")
    .select(COLS.join(","))
    .order("created_at", { ascending: false })
    .limit(50000);
  if (error) return new NextResponse(error.message, { status: 500 });
  const lines = [COLS.join(",")];
  for (const row of (data as unknown as Record<string, unknown>[]) ?? []) {
    lines.push(COLS.map((c) => csv(row[c])).join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log.csv"`,
    },
  });
}

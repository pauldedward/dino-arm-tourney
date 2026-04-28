import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { email, full_name, role } = (await req.json()) as {
    email?: string; full_name?: string; role?: string;
  };
  if (!email || !full_name || !role) {
    return NextResponse.json({ ok: false, error: "email, full_name, role required" }, { status: 400 });
  }
  const admin = createAdminClient();
  const tempPassword = `Dino-${randomBytes(6).toString("base64url")}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error || !created.user) {
    return NextResponse.json({ ok: false, error: error?.message ?? "create failed" }, { status: 500 });
  }
  await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    full_name,
    role,
    invited_by: sess.user!.id,
    invited_at: new Date().toISOString(),
  });
  await recordAudit({
    action: "user.invite",
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "profiles",
    targetId: created.user.id,
    payload: { email, role },
  });
  return NextResponse.json({ ok: true, tempPassword });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ disabled_at: null }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await recordAudit({
    action: "user.enable",
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "profiles",
    targetId: id,
  });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  if (id === sess.user!.id) return NextResponse.json({ ok: false, error: "Cannot change own role" }, { status: 400 });
  const { role } = (await req.json()) as { role?: string };
  if (!role) return NextResponse.json({ ok: false, error: "role required" }, { status: 400 });

  const admin = createAdminClient();
  // Last super-admin guard.
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
  if (target?.role === "super_admin" && role !== "super_admin") {
    const { count } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "super_admin")
      .is("disabled_at", null);
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ ok: false, error: "Cannot demote the last super-admin" }, { status: 409 });
    }
  }
  const { error } = await admin.from("profiles").update({ role }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await recordAudit({
    action: role === "super_admin" ? "user.promote_super" : "user.role.change",
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "profiles",
    targetId: id,
    payload: { role },
  });
  return NextResponse.json({ ok: true });
}

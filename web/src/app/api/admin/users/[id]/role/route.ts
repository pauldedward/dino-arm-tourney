import { NextRequest, NextResponse } from "next/server";
import { requireRole, type Role } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const VALID_ROLES: Role[] = ["super_admin", "operator", "athlete"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("super_admin", "/admin/users");
  if (id === session.userId) {
    return NextResponse.json({ error: "cannot change own role" }, { status: 400 });
  }
  const { role } = (await req.json()) as { role?: Role };
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }

  const svc = createServiceClient();

  // If demoting from super_admin, ensure at least one other super_admin remains.
  const { data: existing } = await svc
    .from("profiles")
    .select("id, role")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (existing.role === "super_admin" && role !== "super_admin") {
    const { count } = await svc
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "super_admin")
      .is("disabled_at", null);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "cannot demote the only remaining super admin" },
        { status: 400 }
      );
    }
  }

  const { error } = await svc.from("profiles").update({ role }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "user.role_change",
    targetTable: "profiles",
    targetId: id,
    payload: { from: existing.role, to: role },
  });

  return NextResponse.json({ ok: true });
}

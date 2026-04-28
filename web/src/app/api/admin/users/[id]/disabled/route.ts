import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("super_admin", "/admin/users");
  if (id === session.userId) {
    return NextResponse.json({ error: "cannot disable self" }, { status: 400 });
  }
  const { disabled } = (await req.json()) as { disabled?: boolean };
  if (typeof disabled !== "boolean") {
    return NextResponse.json({ error: "disabled flag required" }, { status: 400 });
  }

  const svc = createServiceClient();

  const { data: existing } = await svc
    .from("profiles")
    .select("id, role")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (disabled && existing.role === "super_admin") {
    const { count } = await svc
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "super_admin")
      .is("disabled_at", null);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "cannot disable the only remaining super admin" },
        { status: 400 }
      );
    }
  }

  const { error } = await svc
    .from("profiles")
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: disabled ? "user.disable" : "user.reenable",
    targetTable: "profiles",
    targetId: id,
  });

  return NextResponse.json({ ok: true });
}

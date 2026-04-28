import { NextRequest, NextResponse } from "next/server";
import { requireRole, type Role } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const VALID_ROLES: Role[] = ["super_admin", "operator", "athlete"];

/**
 * POST /api/admin/users/bulk
 *
 * Body:
 *   { op: "role", ids: string[], role: Role }
 *   { op: "disabled", ids: string[], disabled: boolean }
 *
 * Refuses to demote/disable the only remaining active super admin.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "/admin/users");

  let body: { op?: unknown; ids?: unknown; role?: unknown; disabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const op = body.op;
  if (op !== "role" && op !== "disabled") {
    return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? (body.ids.filter(
        (x) => typeof x === "string" && x.length > 0 && x !== session.userId
      ) as string[])
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "no ids" }, { status: 400 });
  }
  if (ids.length > 200) {
    return NextResponse.json({ error: "too many ids (max 200)" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: existing } = await svc
    .from("profiles")
    .select("id, role, disabled_at")
    .in("id", ids);
  const found = existing ?? [];

  // Last-super-admin guard: count active supers and subtract any in `ids`
  // that this op would knock out.
  if (op === "role" || op === "disabled") {
    const { count: activeSupers } = await svc
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "super_admin")
      .is("disabled_at", null);
    const removingSupers = found.filter((p) => {
      if (p.role !== "super_admin" || p.disabled_at) return false;
      if (op === "role") return body.role !== "super_admin";
      return body.disabled === true;
    }).length;
    if ((activeSupers ?? 0) - removingSupers <= 0) {
      return NextResponse.json(
        { error: "cannot remove the only remaining super admin" },
        { status: 400 }
      );
    }
  }

  if (op === "role") {
    const role = body.role as Role;
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }
    const foundIds = found.map((p) => p.id);
    if (foundIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }
    const { error } = await svc
      .from("profiles")
      .update({ role })
      .in("id", foundIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await Promise.all(
      found.map((p) =>
        recordAudit({
          actorId: session.userId,
          actorLabel: session.fullName ?? session.email,
          action: "user.role_change",
          targetTable: "profiles",
          targetId: p.id,
          payload: { from: p.role, to: role, bulk: true },
        })
      )
    );
    return NextResponse.json({ ok: true, updated: foundIds.length });
  }

  // op === "disabled"
  const disabled = body.disabled;
  if (typeof disabled !== "boolean") {
    return NextResponse.json({ error: "disabled flag required" }, { status: 400 });
  }
  const foundIds = found.map((p) => p.id);
  if (foundIds.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }
  const { error } = await svc
    .from("profiles")
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .in("id", foundIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await Promise.all(
    found.map((p) =>
      recordAudit({
        actorId: session.userId,
        actorLabel: session.fullName ?? session.email,
        action: disabled ? "user.disable" : "user.reenable",
        targetTable: "profiles",
        targetId: p.id,
        payload: { bulk: true },
      })
    )
  );
  return NextResponse.json({ ok: true, updated: foundIds.length });
}

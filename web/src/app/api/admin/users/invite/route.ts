import { NextRequest, NextResponse } from "next/server";
import { requireRole, type Role } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const VALID_ROLES: Role[] = ["operator", "super_admin", "athlete"];

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "/admin/users");
  const { email, full_name, role } = (await req.json()) as {
    email?: string;
    full_name?: string;
    role?: Role;
  };
  if (!email || !role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "email and valid role required" }, { status: 400 });
  }

  const svc = createServiceClient();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(
    "/account/set-password"
  )}`;
  const { data: invited, error } = await svc.auth.admin.inviteUserByEmail(
    email.trim(),
    { redirectTo }
  );
  if (error || !invited?.user) {
    return NextResponse.json({ error: error?.message ?? "invite failed" }, { status: 500 });
  }

  const { error: pErr } = await svc.from("profiles").upsert({
    id: invited.user.id,
    email: email.trim(),
    full_name: full_name ?? null,
    role,
    invited_by: session.userId,
    invited_at: new Date().toISOString(),
  });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  await recordAudit({
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "user.invite",
    targetTable: "profiles",
    targetId: invited.user.id,
    payload: { email: email.trim(), role },
  });

  return NextResponse.json({ ok: true });
}

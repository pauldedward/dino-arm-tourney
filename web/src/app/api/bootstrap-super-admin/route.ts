import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EMAIL = "edward2000ed@gmail.com";

export async function POST(req: NextRequest) {
  const { email, password, full_name } = (await req.json()) as {
    email?: string;
    password?: string;
    full_name?: string;
  };

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "email and password required" },
      { status: 400 }
    );
  }
  if (email.trim().toLowerCase() !== ALLOWED_EMAIL) {
    return NextResponse.json(
      { ok: false, error: "This bootstrap is reserved." },
      { status: 403 }
    );
  }
  if (password.length < 10) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 10 characters." },
      { status: 400 }
    );
  }

  const admin = createServiceClient();

  const { data: existing, error: existingErr } = await admin
    .from("profiles")
    .select("id,email")
    .eq("role", "super_admin")
    .limit(2);
  if (existingErr) {
    return NextResponse.json(
      { ok: false, error: existingErr.message },
      { status: 500 }
    );
  }
  // Allow re-bootstrap (password reset) only if the sole existing super_admin
  // is the whitelisted email. Otherwise refuse.
  if (existing && existing.length > 0) {
    const onlyOwner =
      existing.length === 1 &&
      (existing[0].email ?? "").toLowerCase() === ALLOWED_EMAIL;
    if (!onlyOwner) {
      return NextResponse.json(
        { ok: false, error: "Super admin already exists." },
        { status: 409 }
      );
    }
  }

  let userId: string | null = null;
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list?.users.find(
    (u) => (u.email ?? "").toLowerCase() === ALLOWED_EMAIL
  );
  if (found) {
    userId = found.id;
    await admin.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? "Super Admin" },
    });
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: ALLOWED_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? "Super Admin" },
    });
    if (createErr || !created.user) {
      return NextResponse.json(
        { ok: false, error: createErr?.message ?? "create failed" },
        { status: 500 }
      );
    }
    userId = created.user.id;
  }

  const { error: upsertErr } = await admin.from("profiles").upsert({
    id: userId,
    email: ALLOWED_EMAIL,
    full_name: full_name ?? "Super Admin",
    role: "super_admin",
  });
  if (upsertErr) {
    return NextResponse.json(
      { ok: false, error: upsertErr.message },
      { status: 500 }
    );
  }

  try {
    await recordAudit({
      action: "user.promote_super",
      actorId: userId!,
      actorLabel: full_name ?? ALLOWED_EMAIL,
      targetTable: "profiles",
      targetId: userId!,
      payload: { email: ALLOWED_EMAIL, via: "bootstrap" },
    });
  } catch {
    // audit failure shouldn't block bootstrap
  }

  return NextResponse.json({ ok: true });
}

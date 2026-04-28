import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const admin = createAdminClient();

  // Refuse if a super_admin already exists (one-shot bootstrap).
  const { data: existing, error: existingErr } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "super_admin")
    .limit(1);
  if (existingErr) {
    return NextResponse.json(
      { ok: false, error: existingErr.message },
      { status: 500 }
    );
  }
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { ok: false, error: "Super admin already exists." },
      { status: 409 }
    );
  }

  // If an auth user already exists for this email, reuse it; else create.
  let userId: string | null = null;
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list?.users.find(
    (u) => (u.email ?? "").toLowerCase() === ALLOWED_EMAIL
  );
  if (found) {
    userId = found.id;
    // Ensure password + email confirmed.
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

  await recordAudit({
    action: "user.promote_super",
    actorId: userId!,
    actorLabel: full_name ?? ALLOWED_EMAIL,
    targetTable: "profiles",
    targetId: userId!,
    payload: { email: ALLOWED_EMAIL, via: "bootstrap" },
  });

  return NextResponse.json({ ok: true });
}

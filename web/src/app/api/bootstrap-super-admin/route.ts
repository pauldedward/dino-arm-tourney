import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EMAIL = "edward2000ed@gmail.com";

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("bootstrap-super-admin failed:", e);
    return NextResponse.json(
      { ok: false, error: `bootstrap failed: ${msg}` },
      { status: 500 }
    );
  }
}

async function handle(req: NextRequest) {
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

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY. Set it in Vercel project env vars and redeploy.",
      },
      { status: 500 }
    );
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server is missing NEXT_PUBLIC_SUPABASE_URL. Set it in Vercel project env vars and redeploy.",
      },
      { status: 500 }
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
  // One-shot bootstrap. Once any super_admin exists, this endpoint is
  // permanently disabled — even for the whitelisted email — because it is
  // unauthenticated and would otherwise be a public account-takeover vector.
  // Forgotten password? Use Supabase's password reset email flow instead.
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { ok: false, error: "Super admin already exists." },
      { status: 409 }
    );
  }

  let userId: string | null = null;
  // Page through auth users to find the owner email (listUsers default perPage is 50).
  let page = 1;
  const perPage = 200;
  // Hard cap to avoid runaway loops; 50k users covered.
  for (let i = 0; i < 250; i++) {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (listErr) {
      return NextResponse.json(
        { ok: false, error: `listUsers failed: ${listErr.message}` },
        { status: 500 }
      );
    }
    const found = list?.users.find(
      (u) => (u.email ?? "").toLowerCase() === ALLOWED_EMAIL
    );
    if (found) {
      userId = found.id;
      break;
    }
    if (!list || list.users.length < perPage) break;
    page += 1;
  }

  if (userId) {
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? "Super Admin" },
    });
    if (updErr) {
      return NextResponse.json(
        { ok: false, error: `updateUser failed: ${updErr.message}` },
        { status: 500 }
      );
    }
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

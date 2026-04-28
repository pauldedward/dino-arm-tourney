import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public self-signup. Creates a Supabase auth user + `profiles` row with
 * role='athlete'. The caller must then sign in via /login (or the client
 * can call supabase.auth.signInWithPassword after this returns ok).
 *
 * We use the service client to bypass RLS on `profiles` insert since the
 * current RLS policies only expose SELECT/UPDATE to the user themselves.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    full_name?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = (body.full_name ?? "").trim();

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "email and password required" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const admin = createServiceClient();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || email },
  });
  if (createErr || !created.user) {
    return NextResponse.json(
      { ok: false, error: createErr?.message ?? "create failed" },
      { status: 400 }
    );
  }

  const { error: upsertErr } = await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    full_name: fullName || email,
    role: "athlete",
  });
  if (upsertErr) {
    // Best effort: roll back the auth user so we don't orphan.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { ok: false, error: upsertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

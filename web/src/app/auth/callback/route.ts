import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth / email-link callback.
 *
 * Supabase sends invited / password-reset / magic-link users here with a
 * `?code=…` PKCE code. We exchange it for a session cookie, then redirect
 * the user to `next` (defaults to `/`).
 *
 * For invites we set `next=/account/set-password` in the invite call so the
 * user lands on the "choose your password" screen immediately after the
 * session is established.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const errDesc =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (errDesc) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", errDesc);
    return NextResponse.redirect(back);
  }

  if (!code) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", "Missing auth code in callback URL.");
    return NextResponse.redirect(back);
  }

  const supa = await createClient();
  const { error } = await supa.auth.exchangeCodeForSession(code);
  if (error) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", error.message);
    return NextResponse.redirect(back);
  }

  // Only allow same-origin relative paths in `next` to avoid open-redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Middleware-only Supabase client. Refreshes the auth cookie on every
 * `/admin/*` request and returns the active user + role for gating.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role, disabled_at")
      .eq("id", user.id)
      .maybeSingle();
    if (data && !data.disabled_at) role = data.role as string;
  }

  return { response, user, role };
}

export const OPERATOR_ROLES = new Set([
  "operator",
  "weigh_in_official",
  "super_admin",
  "federation_admin",
  "organiser",
]);

export const SUPER_ADMIN_ROLES = new Set(["super_admin"]);

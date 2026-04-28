import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { cache } from "react";
import { createClient } from "@/lib/db/supabase-server";
import { createServiceClient } from "@/lib/db/supabase-service";

export type Role = "super_admin" | "operator" | "athlete";

/** Hierarchy: higher index → more power. */
const ROLE_RANK: Record<Role, number> = {
  athlete: 0,
  operator: 1,
  super_admin: 2,
};

export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface AdminSession {
  userId: string;
  email: string;
  fullName: string | null;
  role: Role;
}

// Headers populated by proxy.ts (Next 16 middleware) once it has validated
// the JWT and read the profile row. Pages that use `requireRole` /
// `getSession` will read these and skip the (RTT-heavy) Supabase calls.
// Saves ~200ms (1 auth.getUser + 1 profiles SELECT) per protected request.
export const SESSION_HEADERS = {
  id: "x-dino-uid",
  email: "x-dino-email",
  name: "x-dino-name",
  role: "x-dino-role",
  disabled: "x-dino-disabled",
} as const;

async function fromHeaders(): Promise<AdminSession | null> {
  const h = await headers();
  const userId = h.get(SESSION_HEADERS.id);
  const role = h.get(SESSION_HEADERS.role) as Role | null;
  if (!userId || !role) return null;
  if (h.get(SESSION_HEADERS.disabled) === "1") return null;
  return {
    userId,
    email: h.get(SESSION_HEADERS.email) ?? "",
    fullName: h.get(SESSION_HEADERS.name) || null,
    role,
  };
}

/**
 * Per-request memoised session lookup. React `cache()` makes layout +
 * page + nested calls share ONE result. The fast path reads headers
 * stamped by proxy.ts; the slow path falls back to live Supabase calls
 * for routes that bypass middleware (none today, but defensive).
 */
const loadSession = cache(async (): Promise<AdminSession | null> => {
  const cached = await fromHeaders();
  if (cached) return cached;

  // Slow path — should be rare. ~200ms.
  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return null;
  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("id, email, full_name, role, disabled_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.disabled_at) return null;
  return {
    userId: profile.id,
    email: profile.email ?? user.email ?? "",
    fullName: profile.full_name ?? null,
    role: (profile.role ?? "athlete") as Role,
  };
});

/** Returns the current admin session, or null. Does not redirect. */
export async function getSession(): Promise<AdminSession | null> {
  return loadSession();
}

/**
 * Guards an admin route. Redirects to /login when unauthenticated or the
 * user's profile lacks `min` role. Use this at the top of every /admin page.
 */
export async function requireRole(
  min: Role = "operator",
  nextPath: string = "/admin"
): Promise<AdminSession> {
  const session = await loadSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!roleAtLeast(session.role, min)) {
    redirect(`/login?error=${encodeURIComponent("no_access")}`);
  }
  return session;
}

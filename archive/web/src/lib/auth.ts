import { createClient } from "@/lib/supabase/server";

export type SessionInfo = {
  user: { id: string; email: string | null } | null;
  role: string | null;
  fullName: string | null;
};

/**
 * Server-component / route-handler helper. Returns the current operator's
 * profile or a null-shaped object for anonymous requests.
 */
export async function getSession(): Promise<SessionInfo> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, role: null, fullName: null };

  const { data } = await supabase
    .from("profiles")
    .select("role, full_name, disabled_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!data || data.disabled_at) {
    return { user: null, role: null, fullName: null };
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    role: data.role as string,
    fullName: (data.full_name as string | null) ?? null,
  };
}

export function isOperator(role: string | null): boolean {
  return (
    role === "operator" ||
    role === "weigh_in_official" ||
    role === "super_admin" ||
    role === "federation_admin" ||
    role === "organiser"
  );
}

export function isSuperAdmin(role: string | null): boolean {
  return role === "super_admin";
}

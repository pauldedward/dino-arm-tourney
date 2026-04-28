import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-only operations:
 *   - public registration insert (bypasses RLS, validates against event state)
 *   - seeding sample data
 *   - super-admin user invites
 *
 * NEVER import this from client components.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

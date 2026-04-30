import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS.
 * Only usable from server code (route handlers, server actions, scripts).
 * NEVER import this from a client component or a file that might bundle to
 * the browser.
 */
export function createServiceClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !key) {
    throw new Error(
      "supabase service client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  // Defensive: strip trailing slashes and any accidental /rest/v1 or /auth/v1
  // paths so the supabase-js client can build URLs correctly.
  const url = rawUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(rest|auth)\/v1\/?$/, "");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

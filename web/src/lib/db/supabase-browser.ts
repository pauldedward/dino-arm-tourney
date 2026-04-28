import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client for client components.
 * Uses the public anon key. Reads session from cookies set by the server.
 *
 * Memoized at module scope so repeated `createClient()` calls across renders
 * and components reuse one instance — saves SDK init + keeps a single
 * realtime/auth state machine in the page.
 */
let cached: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (!cached) {
    cached = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return cached;
}

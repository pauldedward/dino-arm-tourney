import { cache } from "react";
import { createServiceClient } from "./supabase-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve an admin route param that may be an event UUID or slug.
 * Returns the event id + slug, or null if not found.
 *
 * Memoised per request via React `cache()` so layout + page + nested
 * helpers share the same lookup.
 */
export const resolveEventRef = cache(async (
  param: string,
): Promise<{ id: string; slug: string; name: string; status: string } | null> => {
  const svc = createServiceClient();
  const col = UUID_RE.test(param) ? "id" : "slug";
  const { data } = await svc
    .from("events")
    .select("id, slug, name, status")
    .eq(col, param)
    .maybeSingle();
  return data ?? null;
});

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SESSION_HEADERS } from "@/lib/auth/roles";

interface CookieToSet { name: string; value: string; options?: CookieOptions; }

interface CachedProfile {
  role: string | null;
  email: string | null;
  fullName: string | null;
  disabled: boolean;
  exp: number; // ms epoch
}
// In-process LRU keyed by user id. Profiles change rarely; staleness on
// role change of <30s is acceptable. Saves the ~100ms profiles RTT on
// every warm request. Cleared on process restart.
const PROFILE_TTL_MS = 30_000;
const profileCache = new Map<string, CachedProfile>();
const PROFILE_CACHE_MAX = 1000;

function cacheGet(userId: string): CachedProfile | null {
  const hit = profileCache.get(userId);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    profileCache.delete(userId);
    return null;
  }
  // bump LRU
  profileCache.delete(userId);
  profileCache.set(userId, hit);
  return hit;
}
function cacheSet(userId: string, p: CachedProfile) {
  if (profileCache.size >= PROFILE_CACHE_MAX) {
    const oldest = profileCache.keys().next().value;
    if (oldest) profileCache.delete(oldest);
  }
  profileCache.set(userId, p);
}

/** Decode a JWT payload without verifying. Used only to read `sub`
 *  so we can fire the profile fetch in parallel with auth.getUser()
 *  (which is what actually validates the token). */
function decodeJwtSub(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

async function fetchProfile(userId: string): Promise<CachedProfile | null> {
  try {
    const r = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?select=email,full_name,role,disabled_at&id=eq.${userId}&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
    if (!r.ok) return null;
    const arr = (await r.json()) as Array<{ email: string|null; full_name: string|null; role: string|null; disabled_at: string|null; }>;
    const p = arr[0];
    if (!p) return null;
    return {
      role: p.role ?? null,
      email: p.email ?? null,
      fullName: p.full_name ?? null,
      disabled: !!p.disabled_at,
      exp: Date.now() + PROFILE_TTL_MS,
    };
  } catch { return null; }
}

/**
 * Next 16 middleware. Validates JWT once, stamps x-dino-* headers
 * onto request so requireRole/getSession have ZERO Supabase round-trips.
 *
 * Optimizations:
 *  - Skip auth round-trip entirely on cookieless requests (anonymous fast path).
 *  - 30s in-process profile cache (saves 1 RTT on warm requests).
 *  - JWT-decode locally to derive user id, then run auth.getUser
 *    (validation) IN PARALLEL with profile fetch.
 */
export async function proxy(request: NextRequest) {
  // SECURITY: strip any client-supplied x-dino-* headers before any other
  // logic runs. Downstream code (requireRole/getSession) trusts these
  // headers as proof of an authenticated session, so a forged inbound
  // header would be a trivial impersonation vector. Only this middleware
  // is allowed to stamp them, and only after auth.getUser() succeeds.
  for (const h of Object.values(SESSION_HEADERS)) request.headers.delete(h);

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(list: CookieToSet[]) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    }
  );

  const path = request.nextUrl.pathname;
  const isAdminPath = path.startsWith("/admin");
  const isAthleteRegisterPath = /^\/e\/[^/]+\/register\/?$/.test(path);
  const needsSession = isAdminPath || isAthleteRegisterPath;

  // Skip the auth round-trip on cookieless requests.
  const hasAuthCookie = request.cookies.getAll().some(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
  );
  if (!hasAuthCookie) {
    if (needsSession) return redirectToLogin(request, path);
    return response;
  }

  // Try local JWT decode → kick off profile fetch in parallel with the
  // (network) auth.getUser validation. If we have a cache hit, skip the
  // profile fetch entirely.
  const authCookie = request.cookies.getAll().find(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
  );
  let presumedUid: string | null = null;
  if (authCookie?.value) {
    // Cookie value can be plain JSON-array stringified, base64-prefixed, or chunked.
    const v = authCookie.value;
    let token: string | null = null;
    if (v.startsWith("base64-")) {
      try {
        const decoded = JSON.parse(Buffer.from(v.slice(7), "base64").toString("utf8"));
        if (Array.isArray(decoded)) token = decoded[0] ?? null;
      } catch {}
    } else if (v.startsWith("[") || v.startsWith("{")) {
      try {
        const decoded = JSON.parse(v);
        if (Array.isArray(decoded)) token = decoded[0] ?? null;
        else if (decoded?.access_token) token = decoded.access_token;
      } catch {}
    } else if (v.includes(".") && v.split(".").length === 3) {
      token = v;
    }
    if (token) presumedUid = decodeJwtSub(token);
  }

  let cached = presumedUid ? cacheGet(presumedUid) : null;

  // Race: validate JWT (must succeed) + fetch profile (skipped on cache hit).
  const profilePromise: Promise<CachedProfile | null> =
    cached ? Promise.resolve(cached)
           : presumedUid ? fetchProfile(presumedUid)
           : Promise.resolve(null);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (needsSession) return redirectToLogin(request, path);
    return response;
  }

  // If presumed uid disagreed with validated uid, redo the lookup.
  let profile: CachedProfile | null;
  if (presumedUid && presumedUid === user.id) {
    profile = await profilePromise;
  } else {
    cached = cacheGet(user.id);
    profile = cached ?? (await fetchProfile(user.id));
  }
  if (profile && !cached) cacheSet(user.id, profile);

  const role = profile?.role ?? null;
  const disabled = profile?.disabled ?? false;
  const email = profile?.email ?? null;
  const fullName = profile?.fullName ?? null;

  if (needsSession && (!role || disabled)) {
    return redirectToLogin(request, path, "no_access");
  }

  request.headers.set(SESSION_HEADERS.id, user.id);
  if (role) request.headers.set(SESSION_HEADERS.role, role);
  if (email) request.headers.set(SESSION_HEADERS.email, email);
  if (fullName) request.headers.set(SESSION_HEADERS.name, fullName);
  if (disabled) request.headers.set(SESSION_HEADERS.disabled, "1");

  // Rebuild response so downstream sees the x-dino-* request headers,
  // BUT preserve any cookies Supabase's setAll() wrote during token
  // refresh in auth.getUser(). Without this, the rotated access/refresh
  // cookies are dropped and the user is silently logged out ~1h after
  // login despite continuous activity.
  const refreshed = response.cookies.getAll();
  response = NextResponse.next({ request });
  for (const c of refreshed) {
    const { name, value, ...options } = c;
    response.cookies.set(name, value, options);
  }
  return response;
}

function redirectToLogin(request: NextRequest, path: string, error?: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (error) url.searchParams.set("error", error);
  else url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|cached/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
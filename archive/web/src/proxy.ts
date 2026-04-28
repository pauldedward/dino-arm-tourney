import { type NextRequest, NextResponse } from "next/server";
import {
  OPERATOR_ROLES,
  SUPER_ADMIN_ROLES,
  updateSession,
} from "@/lib/supabase/middleware";

const SUPER_ADMIN_PREFIXES = [
  "/admin/events/new",
  "/admin/events/all-registrations",
  "/admin/users",
  "/admin/audit",
];

const SUPER_ADMIN_API = [
  "/api/events",          // POST = create
  "/api/users",
];

export async function proxy(request: NextRequest) {
  const { response, user, role } = await updateSession(request);
  const path = request.nextUrl.pathname;

  const needsOperator = path.startsWith("/admin") || path.startsWith("/api/admin");
  const needsSuperAdmin =
    SUPER_ADMIN_PREFIXES.some((p) => path.startsWith(p)) ||
    (request.method !== "GET" &&
      SUPER_ADMIN_API.some((p) => path.startsWith(p)));

  if (needsOperator || needsSuperAdmin) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
    if (needsSuperAdmin && !(role && SUPER_ADMIN_ROLES.has(role))) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    if (needsOperator && !(role && OPERATOR_ROLES.has(role))) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *   - _next/static, _next/image, favicon
     *   - public assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)",
  ],
};

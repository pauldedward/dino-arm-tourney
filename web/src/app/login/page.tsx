import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import LoginForm from "./LoginForm";
import { createClient } from "@/lib/db/supabase-server";
import { createServiceClient } from "@/lib/db/supabase-service";
import { roleAtLeast, type Role } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

async function hasSuperAdmin(): Promise<boolean> {
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .limit(1);
    return !!(data && data.length > 0);
  } catch {
    return true;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // If already signed in as operator/super_admin, skip the form and go straight
  // to the admin console (or the requested next path).
  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (user) {
    const svc = createServiceClient();
    const { data: profile } = await svc
      .from("profiles")
      .select("role, disabled_at")
      .eq("id", user.id)
      .maybeSingle();
    const role = (profile?.role ?? null) as Role | null;
    if (profile && !profile.disabled_at && roleAtLeast(role, "operator")) {
      redirect(next && next.startsWith("/") ? next : "/admin");
    }
  }

  const needsBootstrap = !(await hasSuperAdmin());
  return (
    <main className="grid min-h-screen place-items-center bg-bone p-6">
      <div className="w-full max-w-[420px] border-2 border-ink p-8">
        <div className="flex items-center gap-3">
          <Logo size={48} priority />
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/60">
            TTNAWA<br />Tamil Nadu Arm Wrestling
          </p>
        </div>
        <h1 className="mt-4 font-display text-5xl font-black tracking-tight">Sign in</h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Athletes, operators, and referees.
        </p>
        <LoginForm next={next} initialError={error ?? null} />

        <p className="mt-6 font-mono text-xs">
          Athlete? New here?{" "}
          <Link
            href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
            className="underline decoration-blood decoration-2 underline-offset-4 hover:text-blood"
          >
            Create an athlete account →
          </Link>
        </p>

        {needsBootstrap && (
          <div className="mt-6 border-2 border-dashed border-ink p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
              First-time setup
            </p>
            <p className="mt-1 font-mono text-xs">
              No super admin yet.{" "}
              <Link
                href="/register-super-admin"
                className="underline decoration-rust decoration-2 underline-offset-4 hover:text-rust"
              >
                Register the owner account →
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

import Link from "next/link";
import LoginForm from "./LoginForm";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function hasSuperAdmin(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .limit(1);
    return !!(data && data.length > 0);
  } catch {
    return true; // fail-closed: hide the bootstrap link if we can't check
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const needsBootstrap = !(await hasSuperAdmin());
  return (
    <main className="grid min-h-screen place-items-center bg-bone p-6">
      <div className="w-full max-w-[420px] border-2 border-ink p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/60">
          Dino Arm Tourney
        </p>
        <h1 className="mt-2 font-display text-5xl tracking-tight2">Sign in</h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Operator console access only.
        </p>
        <LoginForm next={next} initialError={error ?? null} />

        {needsBootstrap && (
          <div className="mt-6 border-2 border-dashed border-ink p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
              First-time setup
            </p>
            <p className="mt-1 font-mono text-xs">
              No super admin yet.{" "}
              <Link
                href="/register-super-admin"
                className="underline decoration-blood decoration-2 underline-offset-4 hover:text-blood"
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

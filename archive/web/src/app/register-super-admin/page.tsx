import RegisterForm from "./RegisterForm";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function RegisterSuperAdminPage() {
  let alreadyExists = false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .limit(1);
    alreadyExists = !!(data && data.length > 0);
  } catch {
    alreadyExists = false;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bone p-6">
      <div className="w-full max-w-[480px] border-2 border-ink p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/60">
          Dino Arm Tourney · Bootstrap
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight2">
          Register super admin
        </h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          One-time setup. Reserved for the owner email. Disabled once a super
          admin exists.
        </p>

        {alreadyExists ? (
          <div className="mt-6 border-2 border-ink bg-blood/10 p-4 font-mono text-xs">
            A super admin is already registered. This page is disabled.
            <br />
            Go to <a href="/login" className="underline">/login</a>.
          </div>
        ) : (
          <RegisterForm />
        )}
      </div>
    </main>
  );
}

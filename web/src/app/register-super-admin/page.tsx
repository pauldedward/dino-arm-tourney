import Link from "next/link";
import Logo from "@/components/Logo";
import RegisterForm from "./RegisterForm";
import { createServiceClient } from "@/lib/db/supabase-service";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "edward2000ed@gmail.com";

export default async function RegisterSuperAdminPage() {
  let blocked = false;
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("profiles")
      .select("id,email")
      .eq("role", "super_admin")
      .limit(2);
    if (data && data.length > 0) {
      blocked =
        data.length > 1 ||
        (data[0]?.email ?? "").toLowerCase() !== OWNER_EMAIL;
    }
  } catch {
    blocked = false;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bone p-6">
      <div className="w-full max-w-[480px] border-2 border-ink p-8">
        <div className="flex items-center gap-3">
          <Logo size={48} priority />
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/60">
            TTNAWA · Bootstrap
          </p>
        </div>
        <h1 className="mt-2 font-display text-4xl font-black tracking-tight">
          Register super admin
        </h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          One-time setup. Reserved for the owner email. Disabled once a super
          admin exists.
        </p>

        {blocked ? (
          <div className="mt-6 border-2 border-ink bg-rust/10 p-4 font-mono text-xs">
            A super admin is already registered. This page is disabled.
            <br />
            Go to{" "}
            <Link href="/login" className="underline">
              /login
            </Link>
            .
          </div>
        ) : (
          <RegisterForm />
        )}
      </div>
    </main>
  );
}
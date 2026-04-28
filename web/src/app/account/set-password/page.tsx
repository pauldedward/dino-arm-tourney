import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/db/supabase-server";
import SetPasswordForm from "./SetPasswordForm";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    const loginHref = `/login?next=${encodeURIComponent("/account/set-password")}`;
    redirect(loginHref);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bone p-6">
      <div className="w-full max-w-[420px] border-2 border-ink p-8">
        <div className="flex items-center gap-3">
          <Logo size={48} priority />
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/60">
            TTNAWA<br />Tamil Nadu Arm Wrestling
          </p>
        </div>
        <h1 className="mt-4 font-display text-5xl tracking-tight2">
          Set password
        </h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Signed in as <span className="font-bold">{user.email}</span>. Choose a
          password (min 8 characters) to finish setting up your account.
        </p>
        <SetPasswordForm next={next ?? "/"} />
      </div>
    </main>
  );
}

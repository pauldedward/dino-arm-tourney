import Link from "next/link";
import Logo from "@/components/Logo";
import SignupForm from "./SignupForm";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const loginHref = next
    ? `/login?next=${encodeURIComponent(next)}`
    : "/login";
  return (
    <main className="grid min-h-screen place-items-center bg-bone p-6">
      <div className="w-full max-w-[420px] border-2 border-ink p-8">
        <div className="flex items-center gap-3">
          <Logo size={48} priority />
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/60">
            TTNAWA<br />Tamil Nadu Arm Wrestling
          </p>
        </div>
        <h1 className="mt-4 font-display text-5xl tracking-tight2">Sign up</h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Create an athlete account to register for events. One account per
          athlete — you can register for each event only once. Operators are
          invited by a super admin.
        </p>
        <SignupForm next={next} />
        <p className="mt-6 font-mono text-xs">
          Already have an account?{" "}
          <Link
            href={loginHref}
            className="underline decoration-blood decoration-2 underline-offset-4 hover:text-blood"
          >
            Sign in →
          </Link>
        </p>
      </div>
    </main>
  );
}

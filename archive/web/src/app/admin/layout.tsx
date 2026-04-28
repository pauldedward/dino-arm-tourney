import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, isOperator, isSuperAdmin } from "@/lib/auth";
import SignOutButton from "./SignOutButton";
import SyncStatusPill from "@/components/SyncStatusPill";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sess = await getSession();
  if (!sess.user) redirect("/login?next=/admin");
  if (!isOperator(sess.role)) redirect("/login?error=Forbidden");

  return (
    <div className="min-h-screen bg-bone">
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-ink text-bone">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-display text-xl tracking-tight2">
              Dino · Console
            </Link>
            <nav className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.3em]">
              <Link href="/admin/events" className="hover:text-volt">Events</Link>
              <Link href="/admin/events/all-registrations" className="hover:text-volt">Registrations</Link>
              <Link href="/admin/weighin" className="hover:text-volt">Weigh-in</Link>
              <Link href="/admin/categories" className="hover:text-volt">Categories</Link>
              <Link href="/admin/print" className="hover:text-volt">Print</Link>
              {isSuperAdmin(sess.role) && (
                <>
                  <Link href="/admin/users" className="hover:text-volt">Users</Link>
                  <Link href="/admin/audit" className="hover:text-volt">Audit</Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em]">
            <SyncStatusPill />
            <span className="opacity-60">
              {sess.fullName ?? sess.user.email} · {sess.role}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1400px] p-6">{children}</div>
    </div>
  );
}

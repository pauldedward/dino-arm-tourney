import Link from "next/link";
import Logo from "@/components/Logo";
import { requireRole } from "@/lib/auth/roles";
import SignOutButton from "./SignOutButton";
import SyncPill from "@/components/admin/SyncPill";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("operator", "/admin");
  const isSuper = session.role === "super_admin";

  return (
    <div className="min-h-screen bg-bone text-ink">
      <RegisterServiceWorker />
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-bone">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-display text-xl font-black tracking-tight">
            <Logo size={32} />
            <span>TTNAWA<span className="text-rust">.</span>Admin</span>
          </Link>
          <nav className="flex flex-1 items-center gap-5 font-mono text-[11px] uppercase tracking-[0.2em]">
            <Link href="/admin/events" className="hover:text-rust">Events</Link>
            {isSuper && <Link href="/admin/users" className="hover:text-rust">Users</Link>}
            {isSuper && <Link href="/admin/audit" className="hover:text-rust">Audit</Link>}
          </nav>
          <div className="flex items-center gap-4">
            <SyncPill />
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">{session.role.replace("_", " ")}</p>
              <p className="font-mono text-xs">{session.fullName ?? session.email}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
    </div>
  );
}
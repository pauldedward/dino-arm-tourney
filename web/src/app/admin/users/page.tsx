import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import UsersTable from "./UsersTable";
import InviteForm from "./InviteForm";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireRole("super_admin", "/admin/users");
  const svc = createServiceClient();
  const { data: users } = await svc
    .from("profiles")
    .select("id, email, full_name, role, invited_at, last_seen_at, disabled_at, created_at")
    .order("role", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">Super admin</p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight">Users</h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Invite operators, change roles, disable accounts. Promoting to
          super-admin requires double confirmation.
        </p>
      </div>
      <InviteForm />
      <UsersTable users={users ?? []} meId={me.userId} />
    </div>
  );
}

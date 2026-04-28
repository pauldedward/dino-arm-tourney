import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";
import UsersTable from "./UsersTable";
import InviteForm from "./InviteForm";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) redirect("/admin");
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, email, role, disabled_at, created_at, last_seen_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-5xl tracking-tight2">Users</h1>
      <InviteForm />
      <UsersTable rows={(profiles ?? []) as never} currentUserId={sess.user!.id} />
    </div>
  );
}

import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import NewEventForm from "./NewEventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  await requireRole("super_admin", "/admin/events/new");
  const svc = createServiceClient();
  const { data: orgs } = await svc
    .from("organizations")
    .select("id, name, slug")
    .order("name");
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">
          Create event
        </p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight">
          New event
        </h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Five steps. Don&apos;t worry about every field — you can edit all of
          this later from <code>/admin/events/:id</code>.
        </p>
      </div>
      <NewEventForm organizations={orgs ?? []} />
    </div>
  );
}

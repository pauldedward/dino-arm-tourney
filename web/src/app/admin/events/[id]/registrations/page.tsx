import { redirect } from "next/navigation";
import { resolveEventRef } from "@/lib/db/resolve-event";
import { requireRole } from "@/lib/auth/roles";
import FastRegistrationsTable from "@/components/admin/FastRegistrationsTable";

export const dynamic = "force-dynamic";

export default async function EventRegistrations({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ district?: string; group?: string; q?: string }>;
}) {
  await requireRole("operator", "/admin/events");
  const { id: idOrSlug } = await params;
  const sp = await searchParams;
  const ref = await resolveEventRef(idOrSlug);
  if (!ref) redirect("/admin/events?gone=event");

  return (
    <FastRegistrationsTable
      scope={{ eventId: ref.id, eventName: ref.name, eventSlug: ref.slug }}
      initialQuery={sp.q}
      initialDistrict={sp.district}
      initialGroup={sp.group === "district" ? "district" : undefined}
    />
  );
}

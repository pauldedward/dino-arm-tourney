import Link from "next/link";
import { createServiceClient } from "@/lib/db/supabase-service";
import { requireRole } from "@/lib/auth/roles";
import PendingLink from "@/components/PendingLink";
import DeleteEventButton from "./DeleteEventButton";

export const dynamic = "force-dynamic";

export default async function EventsList({
  searchParams,
}: {
  searchParams?: Promise<{ gone?: string }>;
}) {
  const session = await requireRole("operator", "/admin/events");
  const isSuper = session.role === "super_admin";
  const { gone } = (searchParams ? await searchParams : {}) as { gone?: string };
  const svc = createServiceClient();
  const { data: events } = await svc
    .from("events")
    .select("id, slug, name, status, starts_at, venue_city, venue_state, registration_published_at, registration_closed_at")
    .order("starts_at", { ascending: false });

  return (
    <div className="space-y-8">
      {gone === "event" && (
        <div className="border-2 border-rust bg-rust/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-rust">
          That event no longer exists.
        </div>
      )}
      <div className="flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">
            {session.role.replace("_", " ")}
          </p>
          <h1 className="mt-2 font-display text-5xl font-black tracking-tight">
            Events
          </h1>
        </div>
        <Link
          href="/admin/events/new"
          className="border-2 border-ink bg-ink px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-rust hover:border-rust"
        >
          New event +
        </Link>
      </div>

      <div className="border-2 border-ink">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink bg-kraft/20 text-left font-mono text-[10px] uppercase tracking-[0.25em]">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Venue</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Registration</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(events ?? []).map((e) => (
              <EventRow key={e.id} event={e} isSuper={isSuper} />
            ))}
            {(!events || events.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-ink/50">
                  No events yet. Click “New event” to create the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EventRow({
  event,
  isSuper,
}: {
  event: {
    id: string;
    slug: string;
    name: string;
    status: string;
    starts_at: string;
    venue_city: string | null;
    venue_state: string | null;
    registration_published_at: string | null;
    registration_closed_at: string | null;
  };
  isSuper: boolean;
}) {
  const now = Date.now();
  const opensAt = event.registration_published_at
    ? new Date(event.registration_published_at).getTime()
    : null;
  const closesAt = event.registration_closed_at
    ? new Date(event.registration_closed_at).getTime()
    : null;
  const regOpen =
    opensAt !== null && opensAt <= now && (closesAt === null || closesAt > now);
  const regLabel = regOpen
    ? "open"
    : opensAt && opensAt > now
      ? "scheduled"
      : closesAt && closesAt <= now
        ? "closed"
        : "not set";

  return (
    <tr className="border-b border-ink/10 last:border-b-0 hover:bg-kraft/20">
      <td className="px-4 py-3">
        <PendingLink
          href={`/admin/events/${event.slug}`}
          prefetch
          className="font-display text-base font-bold hover:underline"
        >
          {event.name}
        </PendingLink>
        <p className="font-mono text-[10px] text-ink/50">/{event.slug}</p>
      </td>
      <td className="px-4 py-3 font-mono text-xs">
        {new Date(event.starts_at).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-ink/70">
        {[event.venue_city, event.venue_state].filter(Boolean).join(", ") || "—"}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={event.status} />
      </td>
      <td className="px-4 py-3">
        <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${regOpen ? "text-rust" : "text-ink/50"}`}>
          {regLabel}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <PendingLink
            href={`/admin/events/${event.slug}`}
            prefetch
            className="border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-ink hover:text-bone"
          >
            Manage
          </PendingLink>
          {isSuper && (
            <PendingLink
              href={`/admin/events/${event.slug}/edit`}
              prefetch
              className="border border-ink/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/70 hover:border-ink hover:text-ink"
            >
              Edit
            </PendingLink>
          )}
          {isSuper && (
            <DeleteEventButton eventId={event.id} eventName={event.name} />
          )}
        </div>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "border-ink/30 bg-bone text-ink/60" },
    open: { label: "Published", cls: "border-moss bg-moss text-white" },
    live: { label: "Live", cls: "border-rust bg-rust text-white" },
    completed: { label: "Completed", cls: "border-ink/40 bg-ink/10 text-ink" },
    archived: { label: "Archived", cls: "border-ink/20 bg-bone text-ink/40" },
  };
  const m = map[status] ?? map.draft;
  return (
    <span
      className={`inline-block border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

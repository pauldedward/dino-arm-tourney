import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";
import {
  publishEvent,
  closeEvent,
  reopenEvent,
  archiveEvent,
  unarchiveEvent,
  deleteEvent,
} from "../actions";
import DeleteEventForm from "./DeleteEventForm";

export const dynamic = "force-dynamic";

export default async function EventOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sess = await getSession();
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("*").eq("id", id).maybeSingle();
  if (!event) notFound();

  const [{ count: regs }, { count: pendingPay }, { count: weighed }] = await Promise.all([
    admin.from("registrations").select("*", { count: "exact", head: true }).eq("event_id", id),
    admin.from("payments").select("*, registrations!inner(event_id)", { count: "exact", head: true })
      .eq("status", "submitted").eq("registrations.event_id", id),
    admin.from("registrations").select("*", { count: "exact", head: true })
      .eq("event_id", id).eq("status", "weighed_in"),
  ]);

  const isOpen = !!event.registration_published_at && !event.registration_closed_at;
  const isClosed = !!event.registration_closed_at;
  const isArchived = event.status === "archived";

  async function actPublish() { "use server"; await publishEvent(id); }
  async function actClose() { "use server"; await closeEvent(id); }
  async function actReopen() { "use server"; await reopenEvent(id); }
  async function actArchive() { "use server"; await archiveEvent(id); }
  async function actUnarchive() { "use server"; await unarchiveEvent(id); }
  async function actDelete(fd: FormData) { "use server"; await deleteEvent(id, fd); }

  return (
    <div className="space-y-6">
      <Link href="/admin/events" className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60 hover:text-ink">
        ← Events
      </Link>

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl tracking-tight2">{event.name}</h1>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.3em] text-ink/60">
            {event.slug} · {new Date(event.starts_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="border-2 border-ink px-3 py-1 font-mono text-xs uppercase">
            {event.status}
          </span>
          {isSuperAdmin(sess.role) && (
            <Link
              href={`/admin/events/${id}/edit`}
              className="border-2 border-ink bg-bone px-3 py-1 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-volt"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-ink md:grid-cols-4">
        <Tile n={String(regs ?? 0)} l="Registrations" />
        <Tile n={String(pendingPay ?? 0)} l="Payments to verify" />
        <Tile n={String(weighed ?? 0)} l="Weighed in" />
        <Tile n={isOpen ? "OPEN" : isClosed ? "CLOSED" : "DRAFT"} l="Registration" />
      </div>

      {isSuperAdmin(sess.role) && (
        <div className="flex flex-wrap gap-3">
          {!event.registration_published_at && (
            <form action={actPublish}>
              <button className="border-2 border-ink bg-ink px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood">
                Publish & open registration
              </button>
            </form>
          )}
          {isOpen && (
            <form action={actClose}>
              <button className="border-2 border-ink bg-bone px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-blood hover:text-bone">
                Close registration
              </button>
            </form>
          )}
          {isClosed && (
            <form action={actReopen}>
              <button className="border-2 border-ink bg-bone px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-volt">
                Reopen registration
              </button>
            </form>
          )}
          {!isArchived ? (
            <form action={actArchive}>
              <button className="border-2 border-ink bg-bone px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-ink hover:text-bone">
                Archive
              </button>
            </form>
          ) : (
            <form action={actUnarchive}>
              <button className="border-2 border-ink bg-bone px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-volt">
                Unarchive
              </button>
            </form>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card href={`/admin/events/${id}/edit`} title="Edit details" body="All event fields, schedule, money, rules" />
        <Card href={`/admin/events/${id}/registrations`} title="Registrations" body={`${regs ?? 0} entries`} />
        <Card href={`/admin/events/${id}/branding`} title="Branding & ID card" body="Colours, signatory, footer" />
        <Card href={`/e/${event.slug}`} title="Public page" body="Open the spectator view" external />
      </div>

      {isSuperAdmin(sess.role) && (
        <div className="border-2 border-blood bg-blood/5 p-5">
          <p className="font-display text-xl tracking-tight2 text-blood">Danger zone</p>
          <p className="mt-1 font-mono text-xs text-ink/70">
            Permanent delete is only available while the event has zero registrations. Otherwise, archive it.
          </p>
          <DeleteEventForm action={actDelete} eventName={event.name} regCount={regs ?? 0} />
        </div>
      )}
    </div>
  );
}

function Tile({ n, l }: { n: string; l: string }) {
  return (
    <div className="bg-bone p-6">
      <p className="tnum font-display text-4xl tracking-tight2">{n}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">{l}</p>
    </div>
  );
}

function Card({ href, title, body, external }: { href: string; title: string; body: string; external?: boolean }) {
  const inner = (
    <div className="border-2 border-ink p-5 hover:bg-volt">
      <p className="font-display text-xl tracking-tight2">{title}</p>
      <p className="mt-1 font-mono text-xs text-ink/70">{body}</p>
    </div>
  );
  return external ? <a href={href} target="_blank" rel="noreferrer">{inner}</a> : <Link href={href}>{inner}</Link>;
}

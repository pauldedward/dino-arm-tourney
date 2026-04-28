import { createAdminClient } from "@/lib/supabase/admin";
import GenerateButton from "./GenerateButton";

export const dynamic = "force-dynamic";

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<{ event_id?: string }>;
}) {
  const sp = await searchParams;
  const admin = createAdminClient();
  const { data: events } = await admin.from("events").select("id, name, slug").order("starts_at", { ascending: false });
  const eventId = sp.event_id ?? events?.[0]?.id;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-5xl tracking-tight2">Print room</h1>

      <form className="border-2 border-ink p-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Event</span>
          <select
            name="event_id"
            defaultValue={eventId}
            className="mt-2 w-full max-w-md border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          >
            {(events ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
        <button className="mt-3 border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood">
          Switch event
        </button>
      </form>

      {eventId && (
        <>
          <div className="border-2 border-ink p-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">Generate brackets</p>
            <GenerateButton eventId={eventId} />
            <p className="mt-2 font-mono text-xs text-ink/60">
              Wipes existing entries + fixtures and rebuilds from current registrations + latest weigh-ins.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <PrintCard sheet="nominal" eventId={eventId} title="Nominal roll" body="Alpha-sorted attendance sheet." />
            <PrintCard sheet="category" eventId={eventId} title="Category sheet" body="Athletes grouped by category." />
            <PrintCard sheet="idcard"   eventId={eventId} title="ID cards"       body="8 cards / A4 page." />
            <PrintCard sheet="fixtures" eventId={eventId} title="Fixtures"       body="One bracket per category." />
            <PrintCard sheet="dues"     eventId={eventId} title="Pending dues"   body="Outstanding entry-fee payments." />
          </div>
        </>
      )}
    </div>
  );
}

function PrintCard({
  sheet, eventId, title, body,
}: {
  sheet: string; eventId: string; title: string; body: string;
}) {
  return (
    <a
      href={`/api/print/${sheet}?event_id=${eventId}`}
      target="_blank"
      rel="noreferrer"
      className="block border-2 border-ink p-5 hover:bg-volt"
    >
      <p className="font-display text-xl tracking-tight2">{title}</p>
      <p className="mt-1 font-mono text-xs text-ink/70">{body}</p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.3em] text-blood">Open PDF →</p>
    </a>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EventCard = {
  slug: string;
  name: string;
  starts_at: string;
  venue_city: string | null;
  venue_state: string | null;
  registration_published_at: string | null;
  registration_closed_at: string | null;
};

function regStatus(e: EventCard): "open" | "closed" | "soon" {
  if (!e.registration_published_at) return "soon";
  if (e.registration_closed_at && new Date(e.registration_closed_at) <= new Date())
    return "closed";
  return "open";
}

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select(
      "slug, name, starts_at, venue_city, venue_state, registration_published_at, registration_closed_at"
    )
    .not("registration_published_at", "is", null)
    .order("starts_at", { ascending: true })
    .limit(20);

  const events = (data ?? []) as EventCard[];

  return (
    <main className="min-h-screen bg-bone text-ink">
      <nav className="border-b-2 border-ink">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-3">
          <span className="font-display text-2xl tracking-tight2">DINO·ARM·TOURNEY</span>
          <Link
            href="/login"
            className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood"
          >
            Operator login →
          </Link>
        </div>
      </nav>

      <section className="border-b-2 border-ink">
        <div className="mx-auto max-w-[1100px] px-6 py-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/60">
            Tamil Nadu State Arm Wrestling Championship
          </p>
          <h1 className="mt-4 font-display text-[clamp(48px,8vw,112px)] leading-[0.85] tracking-tight2">
            Register. Weigh-in.
            <br />
            <span className="italic text-blood">Get on the table.</span>
          </h1>
          <p className="mt-6 max-w-[640px] text-base leading-relaxed">
            Online registration for state and district arm wrestling events.
            Pick your event below, fill the form, pay the entry fee by UPI,
            upload your screenshot. Bring your chest number to the venue.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-6 py-12">
        <h2 className="font-display text-3xl tracking-tight2">Open events</h2>

        {events.length === 0 ? (
          <div className="mt-6 border-2 border-dashed border-ink/40 p-10 text-center font-mono text-xs uppercase tracking-[0.3em] text-ink/60">
            No events published yet — check back soon.
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-px bg-ink md:grid-cols-2">
            {events.map((e) => {
              const s = regStatus(e);
              return (
                <li key={e.slug} className="bg-bone p-5">
                  <Link href={`/e/${e.slug}`} className="block">
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em]">
                      <span
                        className={
                          s === "open"
                            ? "border border-ink bg-volt px-2 py-1"
                            : s === "closed"
                            ? "border border-ink bg-ink px-2 py-1 text-bone"
                            : "border border-ink/40 px-2 py-1 text-ink/60"
                        }
                      >
                        {s === "open"
                          ? "Registration open"
                          : s === "closed"
                          ? "Closed"
                          : "Coming soon"}
                      </span>
                      <span className="text-ink/60">
                        {new Date(e.starts_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-3 font-display text-2xl leading-tight">{e.name}</p>
                    <p className="mt-1 text-sm text-ink/70">
                      {[e.venue_city, e.venue_state].filter(Boolean).join(", ") ||
                        "Venue TBA"}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="border-t-2 border-ink bg-ink text-bone/60">
        <div className="mx-auto max-w-[1100px] px-6 py-6 font-mono text-[10px] uppercase tracking-[0.3em]">
          © 2026 Dino Arm Tourney · Chennai · Tamil Nadu
        </div>
      </footer>
    </main>
  );
}

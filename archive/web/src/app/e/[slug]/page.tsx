import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  slug: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  description: string | null;
  entry_fee_default_inr: number | null;
  hand: string | null;
  rule_profile_id: string | null;
  registration_published_at: string | null;
  registration_closed_at: string | null;
  banner_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  text_on_primary: string | null;
};

type RegState = "open" | "closed" | "soon";

function regState(e: EventRow): RegState {
  if (!e.registration_published_at) return "soon";
  if (e.registration_closed_at && new Date(e.registration_closed_at) <= new Date())
    return "closed";
  return "open";
}

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, slug, name, starts_at, ends_at, venue_name, venue_city, venue_state, description, entry_fee_default_inr, hand, rule_profile_id, registration_published_at, registration_closed_at, banner_url, primary_color, accent_color, text_on_primary"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();
  const ev = event as EventRow;

  const { data: rule } = ev.rule_profile_id
    ? await supabase
        .from("rule_profiles")
        .select("code, weight_classes")
        .eq("id", ev.rule_profile_id)
        .maybeSingle()
    : { data: null };

  const classes = (rule?.weight_classes ?? []) as Array<{
    code: string;
    label: string;
    division: string;
  }>;

  const state = regState(ev);
  const primary = ev.primary_color ?? "#0f3d2e";
  const onPrimary = ev.text_on_primary ?? "#ffffff";

  return (
    <main className="min-h-screen bg-bone">
      <header className="border-b-2 border-ink" style={{ backgroundColor: primary, color: onPrimary }}>
        <div className="mx-auto max-w-[1100px] px-6 py-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] opacity-80">
            {[ev.venue_city, ev.venue_state].filter(Boolean).join(" · ") || "Venue TBA"}
            {rule?.code ? ` · ${rule.code}` : ""}
          </p>
          <h1 className="mt-3 font-display text-[clamp(40px,7vw,96px)] leading-[0.9] tracking-tight2">
            {ev.name}
          </h1>
          <div className="mt-6 flex flex-wrap items-center gap-3 font-mono text-xs uppercase tracking-[0.3em]">
            <span className="border border-current px-3 py-1">
              {state === "open"
                ? "Registration open"
                : state === "closed"
                ? "Registration closed"
                : "Registration coming soon"}
            </span>
            <span>{new Date(ev.starts_at).toLocaleString()}</span>
            {ev.entry_fee_default_inr != null && (
              <span>Entry ₹{ev.entry_fee_default_inr}</span>
            )}
            {ev.hand && <span>{ev.hand}-hand</span>}
          </div>
        </div>
      </header>

      {ev.description && (
        <section className="border-b-2 border-ink">
          <div className="mx-auto max-w-[1100px] px-6 py-10">
            <p className="max-w-[760px] text-base leading-relaxed text-ink/90">
              {ev.description}
            </p>
          </div>
        </section>
      )}

      {classes.length > 0 && (
        <section className="mx-auto max-w-[1100px] px-6 py-12">
          <h2 className="font-display text-3xl tracking-tight2">Weight classes</h2>
          <div className="mt-6 grid grid-cols-2 gap-px bg-ink md:grid-cols-4 lg:grid-cols-6">
            {classes.map((c) => (
              <div key={c.code} className="bg-bone p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
                  {c.division.replace("_", " ")}
                </p>
                <p className="mt-1 font-display text-lg">{c.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="border-t-2 border-ink">
        <div className="mx-auto max-w-[1100px] px-6 py-10">
          {state === "open" ? (
            <Link
              href={`/e/${ev.slug}/register`}
              className="inline-block border-2 border-ink bg-ink px-6 py-4 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood"
            >
              Register for this event →
            </Link>
          ) : state === "closed" ? (
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-ink/60">
              Registration is closed. See you at the venue.
            </p>
          ) : (
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-ink/60">
              Registration opens soon — check back.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

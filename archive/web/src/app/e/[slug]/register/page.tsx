import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { TN_DISTRICTS } from "@/lib/rules/tn-districts";
import { PARA_CLASSES } from "@/lib/rules/para";
import RegisterForm from "./RegisterForm";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select(
      "id, slug, name, status, registration_published_at, registration_closed_at, entry_fee_default_inr, primary_color, accent_color, text_on_primary, venue_city, venue_state, starts_at"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();

  // Pre-flight gates.
  if (!event.registration_published_at) {
    return <Gate title="Coming soon" body="Registrations are not yet open for this event." slug={slug} />;
  }
  if (event.registration_closed_at) {
    return <Gate title="Closed" body="Registrations have closed for this event." slug={slug} />;
  }

  return (
    <main
      className="min-h-screen bg-bone"
      style={{
        // Per-event accent. Keep base palette intact, override CTA colour.
        ["--event-primary" as string]: event.primary_color ?? "#0f3d2e",
        ["--event-accent" as string]: event.accent_color ?? "#f5c518",
        ["--event-on-primary" as string]: event.text_on_primary ?? "#ffffff",
      }}
    >
      <header
        className="border-b-2 border-ink"
        style={{ backgroundColor: "var(--event-primary)", color: "var(--event-on-primary)" }}
      >
        <div className="mx-auto max-w-[760px] px-6 py-8">
          <Link
            href={`/e/${event.slug}`}
            className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-80 hover:opacity-100"
          >
            ← {event.name}
          </Link>
          <h1 className="mt-3 font-display text-[clamp(36px,6vw,72px)] leading-[0.9] tracking-tight2">
            Register
          </h1>
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.3em] opacity-80">
            {[event.venue_city, event.venue_state].filter(Boolean).join(" · ")} ·
            {" "}Entry ₹{event.entry_fee_default_inr ?? 0}
          </p>
        </div>
      </header>

      <RegisterForm
        eventSlug={event.slug}
        districts={TN_DISTRICTS}
        paraClasses={PARA_CLASSES.map((p) => ({ code: p.code, label: p.label, posture: p.posture }))}
      />
    </main>
  );
}

function Gate({ title, body, slug }: { title: string; body: string; slug: string }) {
  return (
    <main className="min-h-screen bg-bone p-10">
      <div className="mx-auto max-w-[600px] border-2 border-ink p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
          Registration · {slug}
        </p>
        <h1 className="mt-3 font-display text-5xl tracking-tight2">{title}</h1>
        <p className="mt-4 text-sm text-ink/80">{body}</p>
        <Link
          href={`/e/${slug}`}
          className="mt-6 inline-block border-2 border-ink bg-ink px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood"
        >
          ← Event page
        </Link>
      </div>
    </main>
  );
}

import Link from "next/link";
import Logo from "@/components/Logo";
import PaymentModeBadge from "@/components/PaymentModeBadge";
import { createClient } from "@/lib/db/supabase-server";
import { createServiceClient } from "@/lib/db/supabase-service";
import { roleAtLeast, type Role } from "@/lib/auth/roles";

/**
 * Landing — lists every event whose status is not 'draft' plus a prominent
 * CTA to register for any event that is currently open.
 *
 * Deliberately sparse: the real work happens inside /e/<slug> and /admin.
 */
export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<{ gone?: string }>;
}) {
  const supabase = await createClient();
  const { gone } = (searchParams ? await searchParams : {}) as { gone?: string };

  // Decide whether to show the operator-console shortcut in the header.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isOperator = false;
  if (user) {
    const svc = createServiceClient();
    const { data: profile } = await svc
      .from("profiles")
      .select("role, disabled_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profile && !profile.disabled_at) {
      isOperator = roleAtLeast((profile.role ?? null) as Role | null, "operator");
    }
  }

  const { data: events } = await supabase
    .from("events")
    .select("id, slug, name, status, starts_at, venue_city, venue_state, cover_url, registration_published_at, registration_closed_at, primary_color, accent_color, payment_mode")
    .not("status", "in", "(draft,archived)")
    .order("starts_at", { ascending: true });

  return (
    <main className="min-h-screen">
      {gone === "event" && (
        <div className="bg-rust/90 px-6 py-3 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-white">
          That event is no longer available.
        </div>
      )}
      <header className="border-b border-ink/10 bg-moss text-bone">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Logo
              size={40}
              priority
              className="shrink-0 ring-2 ring-bone/30 sm:h-11 sm:w-11"
            />
            <span className="flex min-w-0 flex-col leading-tight sm:flex-row sm:items-baseline sm:gap-3">
              <span className="font-display text-xl font-black tracking-tight sm:text-2xl">
                TTNAWA
              </span>
              <span className="truncate font-display text-xs italic text-gold sm:text-base">
                tamil nadu arm wrestling
              </span>
            </span>
          </Link>
          <Link
            href={isOperator ? "/admin" : "/login"}
            className="shrink-0 text-[11px] uppercase tracking-[0.2em] text-bone/80 hover:text-gold sm:text-sm"
          >
            <span className="sm:hidden">{isOperator ? "Console" : "Login"}</span>
            <span className="hidden sm:inline">{isOperator ? "Access console" : "Operator login"}</span>
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 md:py-24">
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl md:text-7xl">
          Chest<span className="italic text-moss">·</span>to<span className="italic text-moss">·</span>chest.
          <br />
          <span className="text-moss">One table.</span>
          <span className="text-gold"> One minute.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-ink/70">
          Tamil Nadu’s premier state-level arm wrestling championship.
          Register online, walk up to the table, leave with a verdict.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-6 font-display text-2xl font-semibold">
          Current &amp; upcoming events
        </h2>

        {(!events || events.length === 0) ? (
          <p className="text-ink/60">
            No events are published yet. Check back soon.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {events.map((e) => {
              const now = Date.now();
              const opensAt = e.registration_published_at
                ? new Date(e.registration_published_at).getTime()
                : null;
              const closesAt = e.registration_closed_at
                ? new Date(e.registration_closed_at).getTime()
                : null;
              const regOpen =
                opensAt !== null &&
                opensAt <= now &&
                (closesAt === null || closesAt > now);

              return (
                <li
                  key={e.id}
                  className="grain border border-ink/10 bg-white p-6"
                  style={{
                    borderLeft: `6px solid ${e.primary_color ?? "#0f3d2e"}`,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-display text-xl font-bold">
                      {e.name}
                    </h3>
                    <span
                      className="text-[10px] uppercase tracking-[0.2em]"
                      style={{ color: e.accent_color ?? "#f5c518" }}
                    >
                      {e.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink/60">
                    {new Date(e.starts_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}{" "}
                    · {e.venue_city ?? "TBA"}, {e.venue_state ?? "Tamil Nadu"}
                  </p>
                  <div className="mt-3">
                    <PaymentModeBadge mode={e.payment_mode} variant="long" />
                  </div>
                  <div className="mt-4 flex items-center gap-4">
                    <Link
                      href={`/e/${e.slug}`}
                      className="text-sm font-medium underline underline-offset-4"
                    >
                      Event details →
                    </Link>
                    {regOpen && (
                      <Link
                        href={`/e/${e.slug}/register`}
                        className="bg-ink px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-bone hover:bg-moss"
                      >
                        Register
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="border-t border-ink/10 py-8 text-center text-xs uppercase tracking-[0.25em] text-ink/40">
        built for the bone · {new Date().getFullYear()}
      </footer>
    </main>
  );
}
